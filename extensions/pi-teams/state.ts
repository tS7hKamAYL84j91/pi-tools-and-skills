/** Team run state manager — session-first protocol-neutral run events. */

import { createHash, randomUUID } from "node:crypto";
import { isPidAlive } from "../../lib/agent-registry.js";
import type { TeamParticipant, TeamRunNodeRecord, TeamRunRecord } from "./types.js";

/** @public */
export const TEAM_RUN_CUSTOM_TYPE = "pi-teams:run";
const MAX_PERSISTED_OUTPUT_CHARS = 64_000;

/** @public */
export type TeamRunEventKind =
	| "run_started"
	| "phase_started"
	| "node_completed"
	| "run_completed"
	| "run_failed"
	| "run_tombstoned";

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
	protocol: string;
	input: { prompt: string };
	participants?: TeamParticipant[];
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
export type TeamRunEvent =
	| TeamRunStartedEvent
	| TeamRunPhaseStartedEvent
	| TeamRunNodeCompletedEvent
	| TeamRunCompletedEvent
	| TeamRunFailedEvent
	| TeamRunTombstonedEvent;

interface TeamStateManagerOptions {
	appendEntry?: (customType: string, data?: unknown) => void;
}

interface StartRunArgs {
	teamId: string;
	protocol: string;
	prompt: string;
	participants?: TeamParticipant[];
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

function nodeRecord(event: TeamRunNodeCompletedEvent): TeamRunNodeRecord {
	return {
		phaseId: event.phaseId,
		nodeId: event.nodeId,
		role: event.role,
		model: event.model,
		ok: event.ok,
		durationMs: event.durationMs,
		output: event.output ?? "",
		...(event.error ? { error: event.error } : {}),
	};
}

function applyEvent(records: Map<string, TeamRunRecord>, event: TeamRunEvent): void {
	if (event.kind === "run_started") {
		records.set(event.runId, {
			version: 1,
			id: event.runId,
			team: event.teamId,
			protocol: event.protocol,
			prompt: event.input.prompt,
			status: "pending",
			startedAt: event.timestamp,
			orchestratorPid: event.orchestratorPid,
			phases: [],
			nodes: [],
		});
		return;
	}
	const record = records.get(event.runId);
	if (!record) return;
	if (event.kind === "phase_started") {
		record.status = "running";
		if (!record.phases.includes(event.phaseId)) record.phases.push(event.phaseId);
	} else if (event.kind === "node_completed") {
		record.nodes.push(nodeRecord(event));
	} else if (event.kind === "run_completed") {
		record.status = "completed";
		record.completedAt = event.timestamp;
		if (event.summary) record.summary = event.summary;
	} else if (event.kind === "run_failed") {
		record.status = "failed";
		record.error = event.error;
		record.completedAt = event.timestamp;
	} else if (event.kind === "run_tombstoned") {
		records.delete(event.runId);
	}
}

function reduceEvents(events: readonly TeamRunEvent[]): Map<string, TeamRunRecord> {
	const records = new Map<string, TeamRunRecord>();
	for (const event of [...events].sort((a, b) => a.seq - b.seq)) applyEvent(records, event);
	return records;
}

export class TeamStateManager {
	private readonly sequenceByRun = new Map<string, number>();
	private readonly sessionRecords = new Map<string, TeamRunRecord>();
	private sessionHydrated = false;

	constructor(private readonly options: TeamStateManagerOptions = {}) {}

	private nextSeq(runId: string): number {
		const next = (this.sequenceByRun.get(runId) ?? 0) + 1;
		this.sequenceByRun.set(runId, next);
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
		this.options.appendEntry?.(TEAM_RUN_CUSTOM_TYPE, full);
		if (this.sessionHydrated) applyEvent(this.sessionRecords, full);
	}

	startRun(args: StartRunArgs): string {
		const runId = generateId();
		this.appendEvent({
			kind: "run_started",
			runId,
			teamId: args.teamId,
			protocol: args.protocol,
			input: { prompt: args.prompt },
			...(args.participants ? { participants: args.participants } : {}),
		});
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

	rehydrateFromSession(sessionManager: SessionManagerLike): void {
		const entries = sessionManager.getBranch?.() ?? sessionManager.getEntries?.() ?? [];
		const events = entries.filter((entry) => entry.type === "custom" && entry.customType === TEAM_RUN_CUSTOM_TYPE && isRunEvent(entry.data)).map((entry) => entry.data as TeamRunEvent);
		this.sessionRecords.clear();
		this.sessionHydrated = true;
		for (const [id, record] of reduceEvents(events)) this.sessionRecords.set(id, record);
		this.sequenceByRun.clear();
		for (const event of events) this.sequenceByRun.set(event.runId, Math.max(this.sequenceByRun.get(event.runId) ?? 0, event.seq));
	}

	get(id: string): TeamRunRecord | undefined {
		return this.sessionRecords.get(id);
	}

	list(): TeamRunRecord[] {
		return this.sessionHydrated ? [...this.sessionRecords.values()] : [];
	}

	remove(id: string): void {
		this.appendEvent({ kind: "run_tombstoned", runId: id });
		this.sessionRecords.delete(id);
	}

	findOrphans(): TeamRunRecord[] {
		return this.list().filter((record) => {
			if (record.status === "completed" || record.status === "failed") return false;
			return !isPidAlive(record.orchestratorPid);
		});
	}

	markFailed(id: string, reason: string): void {
		if (!this.get(id)) return;
		this.recordRunFailed(id, reason);
	}
}
