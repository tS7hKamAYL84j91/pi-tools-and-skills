/** Team run state manager — session-first protocol-neutral run events. */
import { createHash, randomUUID } from "node:crypto";
import { isPidAlive } from "../../../lib/agent-registry.js";
import { notifyRunSubscribers, subscribeToRun } from "./run-subscriptions.js";
import type { TeamParticipant, TeamRunDetailKind, TeamRunDetailRecord, TeamRunNodeRecord, TeamRunRecord } from "./types.js";

/** @public */
// Preserve the historical customType for persisted session compatibility.
export const TEAM_RUN_CUSTOM_TYPE = "pi-teams:run";
/** @public */
export const TEAM_RUN_EVENT_SCHEMA_VERSION = 1;
/** @public */
export const TEAM_RUN_RECORD_VERSION = 1;
const MAX_PERSISTED_OUTPUT_CHARS = 64_000;
/** @public */
export type TeamRunEventKind =
	| "run_started"
	| "phase_started"
	| "node_started"
	| "node_heartbeat"
	| "node_completed"
	| "run_detail"
	| "stop_requested"
	| "run_stopped"
	| "run_completed"
	| "run_failed"
	| "run_tombstoned";

interface TeamRunEventBase {
	schemaVersion: typeof TEAM_RUN_EVENT_SCHEMA_VERSION;
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
export interface TeamRunNodeStartedEvent extends TeamRunEventBase {
	kind: "node_started";
	phaseId: string;
	nodeId: string;
	role: string;
	model: string;
}

/** @public */
export interface TeamRunNodeHeartbeatEvent extends TeamRunEventBase {
	kind: "node_heartbeat";
	phaseId: string;
	nodeId: string;
	role: string;
	model: string;
	elapsedMs: number;
	runningWorkers: number;
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
export interface TeamRunDetailEvent extends TeamRunEventBase {
	kind: "run_detail";
	detailKind: TeamRunDetailKind;
	phaseId?: string;
	nodeId?: string;
	message: string;
	data?: Record<string, unknown>;
	artifactUri?: string;
	error?: string;
}

/** @public */
export interface TeamRunStopRequestedEvent extends TeamRunEventBase {
	kind: "stop_requested";
	reason: string;
}

/** @public */
export interface TeamRunStoppedEvent extends TeamRunEventBase {
	kind: "run_stopped";
	reason: string;
	durationMs: number;
	summary?: string;
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
	| TeamRunNodeStartedEvent
	| TeamRunNodeHeartbeatEvent
	| TeamRunNodeCompletedEvent
	| TeamRunDetailEvent
	| TeamRunStopRequestedEvent
	| TeamRunStoppedEvent
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

interface RecordNodeStartArgs {
	phaseId: string;
	nodeId: string;
	role: string;
	model: string;
}

interface RecordNodeHeartbeatArgs {
	phaseId: string;
	nodeId: string;
	role: string;
	model: string;
	elapsedMs: number;
	runningWorkers: number;
}

interface RecordDetailArgs {
	kind: TeamRunDetailKind;
	phaseId?: string;
	nodeId?: string;
	message: string;
	data?: Record<string, unknown>;
	artifactUri?: string;
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

function isTeamRunDetailKind(value: unknown): value is TeamRunDetailKind {
	return value === "trace" || value === "handoff" || value === "fallback" || value === "artifact" || value === "error";
}

function isRunEvent(value: unknown): value is TeamRunEvent {
	if (value === null || typeof value !== "object") return false;
	const event = value as { schemaVersion?: unknown; kind?: unknown; runId?: unknown; detailKind?: unknown };
	if (event.schemaVersion !== TEAM_RUN_EVENT_SCHEMA_VERSION || typeof event.kind !== "string" || typeof event.runId !== "string") return false;
	return event.kind !== "run_detail" || isTeamRunDetailKind(event.detailKind);
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
		status: event.ok ? "completed" : "failed",
		updatedAt: event.timestamp,
		...(event.error ? { error: event.error } : {}),
	};
}

function detailRecord(event: TeamRunDetailEvent): TeamRunDetailRecord {
	return {
		kind: event.detailKind,
		...(event.phaseId ? { phaseId: event.phaseId } : {}),
		...(event.nodeId ? { nodeId: event.nodeId } : {}),
		message: event.message,
		...(event.data ? { data: event.data } : {}),
		...(event.artifactUri ? { artifactUri: event.artifactUri } : {}),
		...(event.error ? { error: event.error } : {}),
		timestamp: event.timestamp,
	};
}

function applyEvent(records: Map<string, TeamRunRecord>, event: TeamRunEvent): void {
	if (event.kind === "run_started") {
		records.set(event.runId, {
			version: TEAM_RUN_RECORD_VERSION,
			id: event.runId,
			team: event.teamId,
			protocol: event.protocol,
			prompt: event.input.prompt,
			status: "pending",
			startedAt: event.timestamp,
			orchestratorPid: event.orchestratorPid,
			phases: [],
			nodes: [],
			details: [],
		});
		return;
	}
	const record = records.get(event.runId);
	if (!record) return;
	if (event.kind === "phase_started") {
		record.status = "running";
		if (!record.phases.includes(event.phaseId)) record.phases.push(event.phaseId);
	} else if (event.kind === "node_started") {
		let node = record.nodes.find((n) => n.phaseId === event.phaseId && n.nodeId === event.nodeId);
		if (!node) {
			node = {
				phaseId: event.phaseId,
				nodeId: event.nodeId,
				role: event.role,
				model: event.model,
				ok: false,
				durationMs: 0,
				output: "",
				status: "running",
				startedAt: event.timestamp,
				updatedAt: event.timestamp,
				runningWorkers: 1,
			};
			record.nodes.push(node);
		}
	} else if (event.kind === "node_heartbeat") {
		const node = record.nodes.find((n) => n.phaseId === event.phaseId && n.nodeId === event.nodeId);
		if (node) {
			node.updatedAt = event.timestamp;
			node.runningWorkers = event.runningWorkers;
		}
	} else if (event.kind === "node_completed") {
		const existingIndex = record.nodes.findIndex((n) => n.phaseId === event.phaseId && n.nodeId === event.nodeId);
		const newNode = nodeRecord(event);
		if (existingIndex >= 0) {
			record.nodes[existingIndex] = { ...record.nodes[existingIndex], ...newNode };
		} else {
			record.nodes.push(newNode);
		}
		if (!event.ok && event.error) record.details.push(detailRecord({ ...event, kind: "run_detail", detailKind: "error", message: event.error }));
	} else if (event.kind === "run_detail") {
		record.details.push(detailRecord(event));
	} else if (event.kind === "stop_requested") {
		record.status = "stopping";
		record.stopReason = event.reason;
		for (const node of record.nodes) {
			if (node.status === "running") node.status = "stopped";
		}
	} else if (event.kind === "run_stopped") {
		record.status = "stopped";
		record.stopReason = event.reason;
		record.completedAt = event.timestamp;
		if (event.summary) record.summary = event.summary;
	} else if (event.kind === "run_completed") {
		record.status = "completed";
		delete record.stopReason;
		record.completedAt = event.timestamp;
		if (event.summary) record.summary = event.summary;
	} else if (event.kind === "run_failed") {
		record.status = "failed";
		delete record.stopReason;
		record.error = event.error;
		record.completedAt = event.timestamp;
		for (const node of record.nodes) {
			if (node.status === "running") node.status = "failed";
		}
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
	private readonly stopReasons = new Map<string, string>();
	private readonly abortControllers = new Map<string, AbortController>();
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
			schemaVersion: TEAM_RUN_EVENT_SCHEMA_VERSION,
			seq: this.nextSeq(event.runId),
			timestamp: Date.now(),
			orchestratorPid: process.pid,
		} as TeamRunEvent;
		this.options.appendEntry?.(TEAM_RUN_CUSTOM_TYPE, full);
		applyEvent(this.sessionRecords, full);
		notifyRunSubscribers(this, event.runId);
	}

	startRun(args: StartRunArgs): string {
		const runId = generateId();
		this.stopReasons.delete(runId);
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

	recordNodeStarted(runId: string, args: RecordNodeStartArgs): void {
		this.appendEvent({ kind: "node_started", runId, phaseId: args.phaseId, nodeId: args.nodeId, role: args.role, model: args.model });
	}

	recordNodeHeartbeat(runId: string, args: RecordNodeHeartbeatArgs): void {
		this.appendEvent({ kind: "node_heartbeat", runId, phaseId: args.phaseId, nodeId: args.nodeId, role: args.role, model: args.model, elapsedMs: args.elapsedMs, runningWorkers: args.runningWorkers });
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

	recordDetail(runId: string, args: RecordDetailArgs): void {
		this.appendEvent({
			kind: "run_detail",
			runId,
			detailKind: args.kind,
			message: args.message,
			...(args.phaseId ? { phaseId: args.phaseId } : {}),
			...(args.nodeId ? { nodeId: args.nodeId } : {}),
			...(args.data ? { data: args.data } : {}),
			...(args.artifactUri ? { artifactUri: args.artifactUri } : {}),
			...(args.error ? { error: args.error } : {}),
		});
	}

	recordRunCompleted(runId: string, durationMs: number, summary?: string): void {
		this.abortControllers.delete(runId);
		this.stopReasons.delete(runId);
		this.appendEvent({ kind: "run_completed", runId, ok: true, durationMs, ...(summary ? { summary: summary.slice(0, MAX_PERSISTED_OUTPUT_CHARS) } : {}) });
	}

	recordRunFailed(runId: string, error: string): void {
		this.abortControllers.delete(runId);
		this.stopReasons.delete(runId);
		this.appendEvent({ kind: "run_failed", runId, ok: false, error });
	}

	recordRunStopped(runId: string, durationMs: number, reason: string, summary?: string): void {
		this.abortControllers.delete(runId);
		this.stopReasons.delete(runId);
		this.appendEvent({ kind: "run_stopped", runId, reason, durationMs, ...(summary ? { summary: summary.slice(0, MAX_PERSISTED_OUTPUT_CHARS) } : {}) });
	}

	rehydrateFromSession(sessionManager: SessionManagerLike): void {
		const entries = sessionManager.getBranch?.() ?? sessionManager.getEntries?.() ?? [];
		const events = entries.filter((entry) => entry.type === "custom" && entry.customType === TEAM_RUN_CUSTOM_TYPE && isRunEvent(entry.data)).map((entry) => entry.data as TeamRunEvent);
		this.sessionRecords.clear();
		this.sessionHydrated = true;
		for (const [id, record] of reduceEvents(events)) this.sessionRecords.set(id, record);
		this.sequenceByRun.clear();
		this.stopReasons.clear();
		for (const event of events) {
			this.sequenceByRun.set(event.runId, Math.max(this.sequenceByRun.get(event.runId) ?? 0, event.seq));
			if (event.kind === "stop_requested") this.stopReasons.set(event.runId, event.reason);
			if (event.kind === "run_completed" || event.kind === "run_failed" || event.kind === "run_stopped" || event.kind === "run_tombstoned") this.stopReasons.delete(event.runId);
		}
	}

	get(id: string): TeamRunRecord | undefined {
		return this.sessionRecords.get(id);
	}

	/** Subscribe to transient in-memory updates for one run. */
	subscribe(runId: string, listener: () => void): () => void {
		return subscribeToRun(this, runId, listener);
	}

	/** Return the newest pending/running run, with id as a stable tie-breaker. */
	newestActiveRun(): TeamRunRecord | undefined {
		let newest: TeamRunRecord | undefined;
		for (const record of this.sessionRecords.values()) {
			if (record.status !== "pending" && record.status !== "running") continue;
			if (!newest || record.startedAt > newest.startedAt || (record.startedAt === newest.startedAt && record.id > newest.id)) {
				newest = record;
			}
		}
		return newest;
	}

	list(): TeamRunRecord[] {
		return this.sessionHydrated ? [...this.sessionRecords.values()] : [];
	}

	remove(id: string): void {
		this.abortControllers.delete(id);
		this.stopReasons.delete(id);
		this.appendEvent({ kind: "run_tombstoned", runId: id });
		this.sessionRecords.delete(id);
	}

	findOrphans(): TeamRunRecord[] {
		return this.list().filter((record) => {
			if (record.status === "completed" || record.status === "failed") return false;
			return !isPidAlive(record.orchestratorPid);
		});
	}

	registerAbortController(id: string, controller: AbortController): void {
		this.abortControllers.set(id, controller);
		if (this.isStopRequested(id)) controller.abort();
	}

	requestStop(id: string, reason: string): boolean {
		const record = this.get(id);
		if (!record || record.status === "completed" || record.status === "failed" || record.status === "stopped") return false;
		const existing = this.stopReasons.get(id);
		const finalReason = existing ?? reason;
		if (!existing) {
			this.stopReasons.set(id, finalReason);
			this.appendEvent({ kind: "stop_requested", runId: id, reason: finalReason });
		}
		this.abortControllers.get(id)?.abort();
		return true;
	}

	isStopRequested(id: string): boolean {
		return this.stopReasons.has(id);
	}

	stopReason(id: string): string | undefined {
		return this.stopReasons.get(id);
	}

	markFailed(id: string, reason: string): void {
		if (!this.get(id)) return;
		this.recordRunFailed(id, reason);
	}
}
