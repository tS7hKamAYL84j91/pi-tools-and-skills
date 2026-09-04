/** pi-event-loop types: configuration, runtime facts, projections, commands, and identity helpers. */
import { createHash } from "node:crypto";

// --- Configuration (SPEC §6) ---

export type EmissionPolicy = "command-contract";

export interface EventSpec {
	readonly description: string;
	readonly allowAgentEmit: boolean;
	readonly requiredPayload: readonly string[];
	/** Set when the event is a valid observation outside any active command turn. */
	readonly allowWithoutCommand?: boolean;
}

export interface CommandSpec {
	readonly message: string;
	readonly expectedEvents: readonly string[];
}

export interface ProjectionRule {
	readonly event: string;
	/** JSON Pointer (RFC 6901) selecting the projection key inside the event payload. */
	readonly keyFrom: string;
}

export interface ViewSpec {
	readonly type: "todo";
	readonly openOn: readonly ProjectionRule[];
	readonly closeOn: readonly ProjectionRule[];
}

export interface AutomationSpec {
	readonly id: string;
	readonly view: string;
	readonly issue: string;
}

export interface TimerSpec {
	readonly id: string;
	readonly intervalMinutes?: number;
	/** "HH:MM" in the configured host timezone. */
	readonly dailyAt?: string;
	readonly emit: string;
}

export interface LimitsConfig {
	readonly maxPendingCommands: number;
	readonly maxOpenItemsPerView: number;
	readonly maxPayloadBytes: number;
	readonly maxChainDepth: number;
	readonly maxConsecutiveTurns: number;
	readonly maxRecentEvents: number;
}

export interface ProfileConfig {
	readonly emissionPolicy: EmissionPolicy;
	readonly events: Readonly<Record<string, EventSpec>>;
	readonly commands: Readonly<Record<string, CommandSpec>>;
	readonly views: Readonly<Record<string, ViewSpec>>;
	readonly automations: readonly AutomationSpec[];
	readonly timers: readonly TimerSpec[];
}

export interface EventLoopConfig {
	readonly version: 1;
	readonly activeProfile: string;
	readonly profiles: Readonly<Record<string, ProfileConfig>>;
	readonly limits: LimitsConfig;
}

// --- Runtime facts (SPEC §7, §8) ---

export type EventSource = "agent" | "operator" | "timer" | "system";

/** Data stored in one immutable custom session entry (SPEC §8). */
export interface LoopEventData {
	readonly eventId: string;
	readonly type: string;
	readonly occurredAt: string;
	readonly source: EventSource;
	readonly payload: Readonly<Record<string, unknown>>;
	/** Active command when the event was emitted, if any. */
	readonly commandId?: string;
	readonly workItemId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

/** customType for immutable event-log entries. */
export const EVENT_LOOP_EVENT_CUSTOM_TYPE = "pi-event-loop-event";

/** customType for the bounded checkpoint snapshot (SPEC §15). */
export const SNAPSHOT_CUSTOM_TYPE = "pi-event-loop-snapshot";

// --- Projections (SPEC §9) ---

export type TodoStatus = "outstanding" | "dispatched" | "completed" | "stalled";

export interface TodoItem {
	readonly workItemId: string;
	readonly viewId: string;
	readonly key: string;
	readonly openedByEventId: string;
	readonly sourcePayload: Readonly<Record<string, unknown>>;
	readonly status: TodoStatus;
	readonly commandId?: string;
	readonly completedByEventId?: string;
}

// --- Commands (SPEC §10, §11) ---

export type CommandStatus =
	| "queued"
	| "active"
	| "delivered"
	| "settled"
	| "cancelled";

export interface CommandRecord {
	readonly commandId: string;
	readonly type: string;
	readonly automationId: string;
	readonly workItemId: string;
	readonly viewId: string;
	readonly correlationId: string;
	readonly causedBy: string;
	readonly message: string;
	readonly expectedEvents: readonly string[];
	readonly workItem: Readonly<Record<string, unknown>>;
	readonly status: CommandStatus;
}

/** customType for self-describing command messages delivered to the agent. */
export const COMMAND_MESSAGE_CUSTOM_TYPE = "pi-event-loop-command";

// --- Emission (SPEC §7) ---

export interface EmittedEventInput {
	readonly event: string;
	readonly dedupeKey?: string;
	readonly payload?: Readonly<Record<string, unknown>>;
}

/** Type alias (not interface) so it satisfies lib/tool-result's Record<string, unknown> details contract. */
export type EmitOutcome = {
	readonly eventId: string;
	readonly duplicate: boolean;
	readonly workItemIds: readonly string[];
	readonly commandIds: readonly string[];
};

/** Effects produced by the post-append pipeline; filled by projections and automations (SPEC §7). */
export interface PostAppendEffects {
	readonly workItemIds: readonly string[];
	readonly commandIds: readonly string[];
}

/** Pipeline applied after an event is appended: project → scan views → queue commands. */
export type PostAppendPipeline = (
	event: LoopEventData,
	config: EventLoopConfig,
	profileName: string,
) => PostAppendEffects;

// --- Persistence (SPEC §12, §15) ---

/** @public Consumed by the P5 session-state module and profile authors (SPEC §15). */
export interface TimerOccurrenceState {
	readonly lastIntervalFiredAt?: number;
	readonly lastDailyDate?: string;
}

/** @public Snapshot shape persisted to the session log; consumed by the P5 session-state module (SPEC §15). */
export interface EventLoopSnapshot {
	readonly schemaVersion: 1;
	readonly profileName: string;
	readonly configFingerprint: string;
	readonly projectedEventCount: number;
	/** Event id of the last event applied to the checkpoint; recovery replays later events. */
	readonly lastAppliedEventId?: string;
	readonly items: readonly TodoItem[];
	readonly pendingCommands: readonly CommandRecord[];
	readonly activeCommand?: CommandRecord;
	readonly recentEventIds: readonly string[];
	readonly timerState: Readonly<Record<string, TimerOccurrenceState>>;
	readonly paused: boolean;
	readonly pauseReason?: string;
	readonly consecutiveAutomatedTurns: number;
}

// --- Deterministic identity (SPEC §8-§10) ---

function stableId(prefix: string, parts: readonly string[]): string {
	const hash = createHash("sha256");
	for (const part of parts) {
		hash.update(part, "utf8");
		hash.update("\u0000", "utf8");
	}
	return `${prefix}-${hash.digest("hex")}`;
}

/**
 * Event identity: sha256(profile + eventType + dedupeKey).
 * Timer events pass the timer id as eventType and the scheduled occurrence as dedupeKey.
 */
export function deriveEventId(
	profileName: string,
	eventType: string,
	dedupeKey: string,
): string {
	return stableId("evt", [profileName, eventType, dedupeKey]);
}

/** Work-item identity: sha256(profile + viewId + key + openingEventId). */
export function deriveWorkItemId(
	profileName: string,
	viewId: string,
	key: string,
	openingEventId: string,
): string {
	return stableId("item", [profileName, viewId, key, openingEventId]);
}

/** Command identity: sha256(profile + automationId + workItemId). */
export function deriveCommandId(
	profileName: string,
	automationId: string,
	workItemId: string,
): string {
	return stableId("cmd", [profileName, automationId, workItemId]);
}
