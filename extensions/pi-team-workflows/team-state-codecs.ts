/** Team run event contracts and persistence codecs. */
import { createHash } from "node:crypto";
import type { TeamParticipant, TeamRunDetailKind, TeamRunDetailRecord, TeamRunNodeRecord } from "./types.js";

/** @public */
export const TEAM_RUN_CUSTOM_TYPE = "pi-teams:run";
/** @public */
export const TEAM_RUN_EVENT_SCHEMA_VERSION = 1;
/** @public */
export const TEAM_RUN_RECORD_VERSION = 1;
/** Maximum persisted text size; hashes still cover the complete value. */
export const MAX_PERSISTED_OUTPUT_CHARS = 64_000;

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
	resultArtifactPath?: string;
}

/** @public */
export interface TeamRunCompletedEvent extends TeamRunEventBase {
	kind: "run_completed";
	ok: true;
	durationMs: number;
	summary?: string;
	resultArtifactPath?: string;
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

/** @public */
export interface SessionEntryLike {
	type: string;
	customType?: string;
	data?: unknown;
}

function isTeamRunDetailKind(value: unknown): value is TeamRunDetailKind {
	return value === "trace" || value === "handoff" || value === "fallback" || value === "artifact" || value === "error";
}

export function boundedOutput(output: string): Pick<TeamRunNodeCompletedEvent, "output" | "outputChars" | "outputSha256" | "outputTruncated"> {
	return {
		output: output.slice(0, MAX_PERSISTED_OUTPUT_CHARS),
		outputChars: output.length,
		outputSha256: createHash("sha256").update(output).digest("hex"),
		outputTruncated: output.length > MAX_PERSISTED_OUTPUT_CHARS,
	};
}

function isRunEvent(value: unknown): value is TeamRunEvent {
	if (value === null || typeof value !== "object") return false;
	const event = value as { schemaVersion?: unknown; kind?: unknown; runId?: unknown; detailKind?: unknown };
	if (event.schemaVersion !== TEAM_RUN_EVENT_SCHEMA_VERSION || typeof event.kind !== "string" || typeof event.runId !== "string") return false;
	return event.kind !== "run_detail" || isTeamRunDetailKind(event.detailKind);
}

/** Parse newline-delimited persisted event JSON, ignoring malformed lines. */
function parseTeamRunEventsJsonl(jsonl: string): TeamRunEvent[] {
	const events: TeamRunEvent[] = [];
	for (const line of jsonl.split(/\r?\n/u)) {
		if (!line.trim()) continue;
		try {
			const value: unknown = JSON.parse(line);
			if (isRunEvent(value)) events.push(value);
		} catch {
			// Session logs may contain partial or unrelated lines.
		}
	}
	return events;
}

/** Decode team events from host session entries. */
export function parseTeamRunEvents(entries: readonly SessionEntryLike[]): TeamRunEvent[] {
	const eventLines = entries
		.filter((entry) => entry.type === "custom" && entry.customType === TEAM_RUN_CUSTOM_TYPE)
		.map((entry) => JSON.stringify(entry.data));
	return parseTeamRunEventsJsonl(eventLines.join("\n"));
}

export function nodeRecord(event: TeamRunNodeCompletedEvent): TeamRunNodeRecord {
	return {
		phaseId: event.phaseId, nodeId: event.nodeId, role: event.role, model: event.model,
		ok: event.ok, durationMs: event.durationMs, output: event.output ?? "",
		status: event.ok ? "completed" : "failed", updatedAt: event.timestamp,
		...(event.error ? { error: event.error } : {}),
	};
}

export function detailRecord(event: TeamRunDetailEvent): TeamRunDetailRecord {
	return {
		kind: event.detailKind, ...(event.phaseId ? { phaseId: event.phaseId } : {}),
		...(event.nodeId ? { nodeId: event.nodeId } : {}), message: event.message,
		...(event.data ? { data: event.data } : {}), ...(event.artifactUri ? { artifactUri: event.artifactUri } : {}),
		...(event.error ? { error: event.error } : {}), timestamp: event.timestamp,
	};
}
