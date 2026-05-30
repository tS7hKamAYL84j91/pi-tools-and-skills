/** Structured observability primitives for pi-teams run events. */

import type { TeamRunEvent } from "./state.js";
import type { TeamRunDetailKind, TeamRunRecord } from "./types.js";

/** @public */
export const TEAM_OBSERVABILITY_SCHEMA_VERSION = 1;

/** @public */
export type TeamObservabilityEventKind =
	| "run_started"
	| "run_stopped"
	| "run_completed"
	| "run_failed"
	| "approval_required"
	| "approval_result"
	| "artifact"
	| "error"
	| "handoff"
	| "fallback"
	| "trace";

/** @public */
export interface TeamObservabilityEvent {
	schemaVersion: typeof TEAM_OBSERVABILITY_SCHEMA_VERSION;
	kind: TeamObservabilityEventKind;
	runId: string;
	teamId?: string;
	protocol?: string;
	phaseId?: string;
	nodeId?: string;
	timestamp: number;
	message: string;
	ok?: boolean;
	status?: TeamRunRecord["status"] | "requires_approval";
	durationMs?: number;
	artifactUri?: string;
	error?: string;
	data?: Record<string, unknown>;
}

function detailKindToObservable(kind: TeamRunDetailKind): TeamObservabilityEventKind {
	return kind;
}

function approvalStatus(data: Record<string, unknown> | undefined): TeamObservabilityEventKind | undefined {
	const status = data?.approval;
	if (status === "required" || status === "requires_approval") return "approval_required";
	if (status === "approved" || status === "rejected" || status === "expired") return "approval_result";
	return undefined;
}

function base(event: TeamRunEvent, kind: TeamObservabilityEventKind, message: string): TeamObservabilityEvent {
	return {
		schemaVersion: TEAM_OBSERVABILITY_SCHEMA_VERSION,
		kind,
		runId: event.runId,
		timestamp: event.timestamp,
		message,
	};
}

/** Convert persisted team run events into stable observability primitives. */
export function observabilityEventsFromRunEvents(events: readonly TeamRunEvent[]): TeamObservabilityEvent[] {
	const out: TeamObservabilityEvent[] = [];
	for (const event of events) {
		if (event.kind === "run_started") {
			out.push({ ...base(event, "run_started", `team ${event.teamId} started`), teamId: event.teamId, protocol: event.protocol, status: "running", data: { promptChars: event.input.prompt.length } });
		} else if (event.kind === "run_completed") {
			out.push({ ...base(event, "run_completed", event.summary ?? "team run completed"), ok: true, status: "completed", durationMs: event.durationMs });
		} else if (event.kind === "run_stopped") {
			const status = event.reason.toLowerCase().includes("approval") ? "requires_approval" : "stopped";
			out.push({ ...base(event, "run_stopped", event.summary ?? event.reason), ok: false, status, durationMs: event.durationMs, data: { reason: event.reason } });
		} else if (event.kind === "run_failed") {
			out.push({ ...base(event, "run_failed", event.error), ok: false, status: "failed", error: event.error });
		} else if (event.kind === "node_completed" && !event.ok) {
			out.push({ ...base(event, "error", event.error ?? "team node failed"), phaseId: event.phaseId, nodeId: event.nodeId, ok: false, durationMs: event.durationMs, error: event.error });
		} else if (event.kind === "run_detail") {
			const approvalKind = approvalStatus(event.data);
			const kind = approvalKind ?? detailKindToObservable(event.detailKind);
			out.push({
				...base(event, kind, event.message),
				...(event.phaseId ? { phaseId: event.phaseId } : {}),
				...(event.nodeId ? { nodeId: event.nodeId } : {}),
				...(kind === "approval_required" ? { status: "requires_approval" as const, ok: false } : {}),
				...(kind === "approval_result" ? { ok: event.data?.approval === "approved" } : {}),
				...(event.artifactUri ? { artifactUri: event.artifactUri } : {}),
				...(event.error ? { error: event.error } : {}),
				...(event.data ? { data: event.data } : {}),
			});
		}
	}
	return out;
}

/** Serialize observability events as newline-delimited JSON for future gates/logs. */
export function serializeObservabilityEvents(events: readonly TeamObservabilityEvent[]): string {
	for (const event of events) {
		if (event.schemaVersion !== TEAM_OBSERVABILITY_SCHEMA_VERSION) throw new Error("unsupported team observability schemaVersion");
		if (!event.runId || !event.kind || !event.message || !Number.isFinite(event.timestamp)) throw new Error("invalid team observability event");
	}
	return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}
