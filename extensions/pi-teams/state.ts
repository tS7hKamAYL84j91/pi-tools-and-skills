/** Team run state manager — session-first run events plus legacy file snapshots. */

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isPidAlive } from "../../lib/agent-registry.js";
import type { ModelRun, ReviewRun, TeamParticipant, TeamRunRecord } from "./types.js";

/** @public */
export const DEFAULT_TEAM_RUNS_DIR = join(homedir(), ".pi", "agent", "team-runs");
/** @public */
export const TEAM_RUN_CUSTOM_TYPE = "pi-teams:run";
const TMP_SUBDIR = "tmp";
const MAX_PERSISTED_OUTPUT_CHARS = 64_000;

/** @public */
export type TeamRunEventKind =
	| "run_started"
	| "phase_started"
	| "node_completed"
	| "run_completed"
	| "run_failed"
	| "run_tombstoned"
	| "legacy_imported";

interface TeamRunEventBase {
	schemaVersion: 1;
	kind: TeamRunEventKind;
	runId: string;
	seq: number;
	timestamp: number;
	orchestratorPid: number;
}

/** @public */
export interface TeamRunStartedEvent extends TeamRunEventBase {
	kind: "run_started";
	teamId: string;
	protocol?: string;
	input: { prompt: string };
	members?: TeamParticipant[];
	chairman?: TeamParticipant;
}

/** @public */
export interface TeamRunPhaseStartedEvent extends TeamRunEventBase {
	kind: "phase_started";
	phaseId: string;
	label: string;
}

/** @public */
export interface TeamRunNodeCompletedEvent extends TeamRunEventBase {
	kind: "node_completed";
	phaseId: string;
	nodeId: string;
	role: string;
	model: string;
	ok: boolean;
	durationMs: number;
	output?: string;
	outputChars: number;
	outputSha256: string;
	outputTruncated: boolean;
	error?: string;
}

/** @public */
export interface TeamRunCompletedEvent extends TeamRunEventBase {
	kind: "run_completed";
	ok: true;
	durationMs: number;
	summary?: string;
}

/** @public */
export interface TeamRunFailedEvent extends TeamRunEventBase {
	kind: "run_failed";
	ok: false;
	error: string;
}

/** @public */
export interface TeamRunTombstonedEvent extends TeamRunEventBase {
	kind: "run_tombstoned";
	reason?: string;
}

/** @public */
export interface TeamRunLegacyImportedEvent extends TeamRunEventBase {
	kind: "legacy_imported";
	source: "legacy-file" | "legacy-session";
}

/** @public */
export type TeamRunEvent =
	| TeamRunStartedEvent
	| TeamRunPhaseStartedEvent
	| TeamRunNodeCompletedEvent
	| TeamRunCompletedEvent
	| TeamRunFailedEvent
	| TeamRunTombstonedEvent
	| TeamRunLegacyImportedEvent;

interface TeamStateManagerOptions {
	appendEntry?: (customType: string, data?: unknown) => void;
	filePersistence?: boolean;
}

interface CreateArgs {
	team: string;
	protocol?: string;
	prompt: string;
	members: TeamParticipant[];
	chairman: TeamParticipant;
}

interface StartRunArgs {
	teamId: string;
	protocol: string;
	prompt: string;
}

interface RecordNodeArgs {
	phaseId: string;
	nodeId: string;
	role: string;
	model: string;
	ok: boolean;
	durationMs: number;
	output: string;
	error?: string;
}

interface SessionEntryLike {
	type: string;
	customType?: string;
	data?: unknown;
}

interface SessionManagerLike {
	getBranch?: () => SessionEntryLike[];
	getEntries?: () => SessionEntryLike[];
}

function generateId(): string {
	return `team-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function boundedOutput(output: string): Pick<TeamRunNodeCompletedEvent, "output" | "outputChars" | "outputSha256" | "outputTruncated"> {
	return {
		output: output.slice(0, MAX_PERSISTED_OUTPUT_CHARS),
		outputChars: output.length,
		outputSha256: createHash("sha256").update(output).digest("hex"),
		outputTruncated: output.length > MAX_PERSISTED_OUTPUT_CHARS,
	};
}

function isRunEvent(value: unknown): value is TeamRunEvent {
	return value !== null && typeof value === "object" && (value as { schemaVersion?: unknown }).schemaVersion === 1 && typeof (value as { kind?: unknown }).kind === "string";
}

function reduceEvents(events: readonly TeamRunEvent[]): Map<string, TeamRunRecord> {
	const records = new Map<string, TeamRunRecord>();
	for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
		if (event.kind === "run_started") {
			records.set(event.runId, {
				version: 1,
				id: event.runId,
				team: event.teamId,
				prompt: event.input.prompt,
				members: event.members ?? [],
				chairman: event.chairman ?? { label: "", model: "" },
				status: "pending",
				startedAt: event.timestamp,
				orchestratorPid: event.orchestratorPid,
				generation: [],
				critiques: [],
			});
			continue;
		}
		const record = records.get(event.runId);
		if (!record) continue;
		if (event.kind === "phase_started") {
			record.status = event.phaseId === "generation" ? "generating" : event.phaseId === "critique" ? "critiquing" : event.phaseId === "synthesis" ? "synthesizing" : record.status;
		} else if (event.kind === "node_completed") {
			const run = nodeEventToRun(event, record);
			if (event.phaseId === "generation") record.generation.push(run);
			else if (event.phaseId === "critique") record.critiques.push({ ...run, rankings: "" });
			else if (event.phaseId === "synthesis") record.synthesis = run;
		} else if (event.kind === "run_completed") {
			record.status = "completed";
			record.completedAt = event.timestamp;
		} else if (event.kind === "run_failed") {
			record.status = "failed";
			record.error = event.error;
			record.completedAt = event.timestamp;
		} else if (event.kind === "run_tombstoned") {
			records.delete(event.runId);
		}
	}
	return records;
}

function nodeEventToRun(event: TeamRunNodeCompletedEvent, record: TeamRunRecord): ModelRun {
	const member = [...record.members, record.chairman].find((entry) => entry.label === event.role || entry.model === event.model) ?? {
		label: event.role,
		model: event.model,
	};
	return {
		member,
		prompt: "",
		systemPrompt: "",
		output: event.output ?? "",
		durationMs: event.durationMs,
		ok: event.ok,
		...(event.error ? { error: event.error } : {}),
	};
}

interface TeamStateManagerData {
	options: TeamStateManagerOptions;
	sequenceByRun: Map<string, number>;
	emittedNodes: Set<string>;
	emittedPhases: Set<string>;
	sessionRecords: Map<string, TeamRunRecord>;
	sessionHydrated: boolean;
}

export class TeamStateManager {
	private readonly data: TeamStateManagerData;

	constructor(
		private readonly runsDir: string = DEFAULT_TEAM_RUNS_DIR,
		options: TeamStateManagerOptions = {},
	) {
		this.data = {
			options,
			sequenceByRun: new Map<string, number>(),
			emittedNodes: new Set<string>(),
			emittedPhases: new Set<string>(),
			sessionRecords: new Map<string, TeamRunRecord>(),
			sessionHydrated: false,
		};
	}

	private recordPath(id: string): string {
		return join(this.runsDir, `${id}.json`);
	}

	private tmpPath(id: string): string {
		return join(this.runsDir, TMP_SUBDIR, `${id}-${process.pid}.json`);
	}

	private ensureDirs(): void {
		mkdirSync(join(this.runsDir, TMP_SUBDIR), { recursive: true });
	}

	private nextSeq(runId: string): number {
		const next = (this.data.sequenceByRun.get(runId) ?? 0) + 1;
		this.data.sequenceByRun.set(runId, next);
		return next;
	}

	private appendEvent(event: Record<string, unknown> & { kind: TeamRunEventKind; runId: string }): void {
		const full = {
			...event,
			schemaVersion: 1 as const,
			seq: this.nextSeq(event.runId),
			timestamp: Date.now(),
			orchestratorPid: process.pid,
		} as TeamRunEvent;
		this.data.options.appendEntry?.(TEAM_RUN_CUSTOM_TYPE, full);
	}

	private persistFile(record: TeamRunRecord): void {
		if (this.data.options.filePersistence === false) return;
		this.ensureDirs();
		const tmp = this.tmpPath(record.id);
		writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
		renameSync(tmp, this.recordPath(record.id));
	}

	private emitPhase(record: TeamRunRecord): void {
		const phase = record.status === "generating" ? "generation" : record.status === "critiquing" ? "critique" : record.status === "synthesizing" ? "synthesis" : undefined;
		if (!phase || this.data.emittedPhases.has(`${record.id}:${phase}`)) return;
		this.data.emittedPhases.add(`${record.id}:${phase}`);
		this.appendEvent({ kind: "phase_started", runId: record.id, phaseId: phase, label: phase });
	}

	private emitNode(record: TeamRunRecord, phaseId: string, nodeId: string, run: ModelRun | ReviewRun): void {
		const key = `${record.id}:${phaseId}:${nodeId}`;
		if (this.data.emittedNodes.has(key)) return;
		this.data.emittedNodes.add(key);
		this.appendEvent({
			kind: "node_completed",
			runId: record.id,
			phaseId,
			nodeId,
			role: run.member.label,
			model: run.member.model,
			ok: run.ok,
			durationMs: run.durationMs,
			...boundedOutput(run.output),
			...(run.error ? { error: run.error } : {}),
		});
	}

	private emitDelta(record: TeamRunRecord): void {
		this.emitPhase(record);
		for (const [index, run] of record.generation.entries()) {
			this.emitNode(record, "generation", `generation:${index}`, run);
		}
		for (const [index, run] of record.critiques.entries()) {
			this.emitNode(record, "critique", `critique:${index}`, run);
		}
		if (record.synthesis) this.emitNode(record, "synthesis", "synthesis", record.synthesis);
		if (record.status === "completed") {
			this.appendEvent({ kind: "run_completed", runId: record.id, ok: true, durationMs: (record.completedAt ?? Date.now()) - record.startedAt, ...(record.synthesis?.output ? { summary: record.synthesis.output.slice(0, MAX_PERSISTED_OUTPUT_CHARS) } : {}) });
		} else if (record.status === "failed") {
			this.appendEvent({ kind: "run_failed", runId: record.id, ok: false, error: record.error ?? "failed" });
		}
	}

	create(args: CreateArgs): TeamRunRecord {
		const record: TeamRunRecord = {
			version: 1,
			id: generateId(),
			team: args.team,
			prompt: args.prompt,
			members: args.members,
			chairman: args.chairman,
			status: "pending",
			startedAt: Date.now(),
			orchestratorPid: process.pid,
			generation: [],
			critiques: [],
		};
		this.persistFile(record);
		this.appendEvent({ kind: "run_started", runId: record.id, teamId: record.team, ...(args.protocol ? { protocol: args.protocol } : {}), input: { prompt: record.prompt }, members: record.members, chairman: record.chairman });
		return record;
	}

	startRun(args: StartRunArgs): string {
		const runId = generateId();
		this.appendEvent({ kind: "run_started", runId, teamId: args.teamId, protocol: args.protocol, input: { prompt: args.prompt } });
		return runId;
	}

	recordPhaseStarted(runId: string, phaseId: string, label: string = phaseId): void {
		this.appendEvent({ kind: "phase_started", runId, phaseId, label });
	}

	recordNodeCompleted(runId: string, args: RecordNodeArgs): void {
		this.appendEvent({
			kind: "node_completed",
			runId,
			phaseId: args.phaseId,
			nodeId: args.nodeId,
			role: args.role,
			model: args.model,
			ok: args.ok,
			durationMs: args.durationMs,
			...boundedOutput(args.output),
			...(args.error ? { error: args.error } : {}),
		});
	}

	recordRunCompleted(runId: string, durationMs: number, summary?: string): void {
		this.appendEvent({ kind: "run_completed", runId, ok: true, durationMs, ...(summary ? { summary: summary.slice(0, MAX_PERSISTED_OUTPUT_CHARS) } : {}) });
	}

	recordRunFailed(runId: string, error: string): void {
		this.appendEvent({ kind: "run_failed", runId, ok: false, error });
	}

	update(record: TeamRunRecord, patch: Partial<TeamRunRecord>): TeamRunRecord {
		const next: TeamRunRecord = { ...record, ...patch };
		this.persistFile(next);
		this.emitDelta(next);
		return next;
	}

	rehydrateFromSession(sessionManager: SessionManagerLike): void {
		const entries = sessionManager.getBranch?.() ?? sessionManager.getEntries?.() ?? [];
		const events = entries.filter((entry) => entry.type === "custom" && entry.customType === TEAM_RUN_CUSTOM_TYPE && isRunEvent(entry.data)).map((entry) => entry.data as TeamRunEvent);
		this.data.sessionRecords.clear();
		this.data.sessionHydrated = true;
		for (const [id, record] of reduceEvents(events)) this.data.sessionRecords.set(id, record);
		this.data.sequenceByRun.clear();
		for (const event of events) this.data.sequenceByRun.set(event.runId, Math.max(this.data.sequenceByRun.get(event.runId) ?? 0, event.seq));
	}

	get(id: string): TeamRunRecord | undefined {
		const sessionRecord = this.data.sessionRecords.get(id);
		if (sessionRecord) return sessionRecord;
		try {
			const raw = readFileSync(this.recordPath(id), "utf-8");
			return JSON.parse(raw) as TeamRunRecord;
		} catch {
			return undefined;
		}
	}

	list(): TeamRunRecord[] {
		if (this.data.sessionHydrated) return [...this.data.sessionRecords.values()];
		try {
			this.ensureDirs();
			const files = readdirSync(this.runsDir).filter((file) => file.endsWith(".json"));
			return files.flatMap((file) => {
				try {
					const raw = readFileSync(join(this.runsDir, file), "utf-8");
					return [JSON.parse(raw) as TeamRunRecord];
				} catch {
					return [];
				}
			});
		} catch {
			return [];
		}
	}

	remove(id: string): void {
		this.appendEvent({ kind: "run_tombstoned", runId: id });
		this.data.sessionRecords.delete(id);
		try {
			rmSync(this.recordPath(id), { force: true });
		} catch {
			// best-effort cleanup
		}
	}

	findOrphans(): TeamRunRecord[] {
		return this.list().filter((record) => {
			if (record.status === "completed" || record.status === "failed") return false;
			return !isPidAlive(record.orchestratorPid);
		});
	}

	markFailed(id: string, reason: string): void {
		const record = this.get(id);
		if (!record) return;
		this.update(record, { status: "failed", error: reason, completedAt: Date.now() });
	}
}
