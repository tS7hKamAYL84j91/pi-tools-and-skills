/** Team run state manager — session-first protocol-neutral run events. */
import { randomUUID } from "node:crypto";
import { isPidAlive } from "../../lib/agent-registry.js";
import { notifyRunSubscribers, subscribeToRun } from "./run-subscriptions.js";
import { applyTeamRunEvent, reduceTeamRunEvents } from "./team-state-reducer.js";
import {
	MAX_PERSISTED_OUTPUT_CHARS,
	TEAM_RUN_CUSTOM_TYPE,
	TEAM_RUN_EVENT_SCHEMA_VERSION,
	boundedOutput,
	parseTeamRunEvents,
} from "./team-state-codecs.js";
import type { TeamParticipant, TeamRunDetailKind, TeamRunRecord } from "./types.js";
import type { TeamRunEvent, TeamRunEventKind } from "./team-state-codecs.js";

/** @public */
export {
	TEAM_RUN_CUSTOM_TYPE,
	TEAM_RUN_EVENT_SCHEMA_VERSION,
	TEAM_RUN_RECORD_VERSION,
} from "./team-state-codecs.js";
/** @public */
export type {
	TeamRunEvent,
	TeamRunEventKind,
	TeamRunStartedEvent,
	TeamRunPhaseStartedEvent,
	TeamRunNodeStartedEvent,
	TeamRunNodeHeartbeatEvent,
	TeamRunNodeCompletedEvent,
	TeamRunDetailEvent,
	TeamRunStopRequestedEvent,
	TeamRunStoppedEvent,
	TeamRunCompletedEvent,
	TeamRunFailedEvent,
	TeamRunTombstonedEvent,
} from "./team-state-codecs.js";

interface TeamStateManagerOptions {
	appendEntry?: (customType: string, data?: unknown) => void;
}

interface StartRunArgs {
	teamId: string; protocol: string; prompt: string; participants?: TeamParticipant[];
}
interface RecordNodeArgs {
	phaseId: string; nodeId: string; role: string; model: string; ok: boolean; durationMs: number; output: string; error?: string;
}
interface RecordNodeStartArgs { phaseId: string; nodeId: string; role: string; model: string; }
interface RecordNodeHeartbeatArgs {
	phaseId: string; nodeId: string; role: string; model: string; elapsedMs: number; runningWorkers: number;
}
interface RecordDetailArgs {
	kind: TeamRunDetailKind; phaseId?: string; nodeId?: string; message: string; data?: Record<string, unknown>; artifactUri?: string; error?: string;
}
interface SessionManagerLike {
	getBranch?: () => import("./team-state-codecs.js").SessionEntryLike[];
	getEntries?: () => import("./team-state-codecs.js").SessionEntryLike[];
}

function generateId(): string {
	return `team-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
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
		applyTeamRunEvent(this.sessionRecords, full);
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

	recordRunCompleted(runId: string, durationMs: number, summary?: string, resultArtifactPath?: string): void {
		this.abortControllers.delete(runId);
		this.stopReasons.delete(runId);
		this.appendEvent({ kind: "run_completed", runId, ok: true, durationMs, ...(summary ? { summary: summary.slice(0, MAX_PERSISTED_OUTPUT_CHARS) } : {}), ...(resultArtifactPath ? { resultArtifactPath } : {}) });
	}

	recordRunFailed(runId: string, error: string): void {
		this.abortControllers.delete(runId);
		this.stopReasons.delete(runId);
		this.appendEvent({ kind: "run_failed", runId, ok: false, error });
	}

	recordRunStopped(runId: string, durationMs: number, reason: string, summary?: string, resultArtifactPath?: string): void {
		this.abortControllers.delete(runId);
		this.stopReasons.delete(runId);
		this.appendEvent({ kind: "run_stopped", runId, reason, durationMs, ...(summary ? { summary: summary.slice(0, MAX_PERSISTED_OUTPUT_CHARS) } : {}), ...(resultArtifactPath ? { resultArtifactPath } : {}) });
	}

	rehydrateFromSession(sessionManager: SessionManagerLike): void {
		const entries = sessionManager.getBranch?.() ?? sessionManager.getEntries?.() ?? [];
		const events = parseTeamRunEvents(entries);
		this.sessionRecords.clear();
		this.sessionHydrated = true;
		for (const [id, record] of reduceTeamRunEvents(events)) this.sessionRecords.set(id, record);
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
