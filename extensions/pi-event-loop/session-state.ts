/** Session-state persistence and recovery over Pi session entries (SPEC §11, §15). */

import type { TodoProjection } from "./projector.js";
import { type EventLoopRuntime, resetEventLoopRuntime } from "./runtime.js";
import type {
	EventLoopConfig,
	EventLoopSnapshot,
	LoopEventData,
	PostAppendEffects,
	TodoItem,
} from "./types.js";

/** Completed items kept in the bounded view snapshot for causal-lineage replay (SPEC §15). */
const COMPLETED_ITEM_KEEP = 100;

/**
 * Build the bounded checkpoint snapshot for the current runtime state (SPEC §15):
 * projection items (non-completed plus a bounded completed tail), pending and active
 * commands, recent event ids, timer occurrence state, pause state and turn counter.
 */
export function buildSnapshot(params: {
	readonly runtime: EventLoopRuntime;
	readonly config: EventLoopConfig;
	readonly fingerprint: string;
	readonly recentEventIds: readonly string[];
}): EventLoopSnapshot {
	const { runtime, config } = params;
	return {
		schemaVersion: 1,
		profileName: config.activeProfile,
		configFingerprint: params.fingerprint,
		projectedEventCount: runtime.projectedEventCount,
		lastAppliedEventId: runtime.lastAppliedEventId,
		items: boundedItems(runtime.projection),
		pendingCommands: runtime.queue.filter(
			(record) => record.status === "queued",
		),
		activeCommand: runtime.activeCommand,
		recentEventIds: [...params.recentEventIds],
		timerState: { ...runtime.timerState },
		paused: runtime.paused,
		pauseReason: runtime.paused ? runtime.pauseReason : undefined,
		consecutiveAutomatedTurns: runtime.consecutiveAutomatedTurns,
	};
}

/** Non-completed items in row order plus the most recent completed items for lineage. */
function boundedItems(projection: TodoProjection): readonly TodoItem[] {
	const live: TodoItem[] = [];
	let completedTail: TodoItem[] = [];
	for (const itemId of projection.order) {
		const item = projection.items.get(itemId);
		if (item === undefined) {
			continue;
		}
		if (item.status !== "completed") {
			live.push(item);
			continue;
		}
		completedTail.push(item);
		if (completedTail.length > COMPLETED_ITEM_KEEP) {
			completedTail = completedTail.slice(1);
		}
	}
	return [...live, ...completedTail];
}

/** Restore runtime mutable state from a snapshot (SPEC §15). */
export function applySnapshotToRuntime(
	runtime: EventLoopRuntime,
	snapshot: EventLoopSnapshot,
): void {
	const items = new Map<string, TodoItem>();
	const order: string[] = [];
	for (const item of snapshot.items) {
		items.set(item.workItemId, item);
		order.push(item.workItemId);
	}
	runtime.projection = { items, order };
	runtime.queue = [...snapshot.pendingCommands];
	runtime.activeCommand =
		snapshot.activeCommand !== undefined
			? { ...snapshot.activeCommand }
			: undefined;
	runtime.activeWorkItem =
		snapshot.activeCommand !== undefined
			? items.get(snapshot.activeCommand.workItemId)
			: undefined;
	runtime.paused = snapshot.paused;
	runtime.pauseReason = snapshot.paused ? snapshot.pauseReason : undefined;
	runtime.consecutiveAutomatedTurns = snapshot.consecutiveAutomatedTurns;
	runtime.projectedEventCount = snapshot.projectedEventCount;
	runtime.lastAppliedEventId = snapshot.lastAppliedEventId;
	runtime.timerState = { ...snapshot.timerState };
}

/**
 * SPEC §11: a command delivered before an unclean exit may be delivered again on resume
 * with the same command ID. Requeue the restored active command at the queue head unless
 * its outcome already replayed (item completed) or the item stalled.
 */
export function requeueActiveCommand(runtime: EventLoopRuntime): boolean {
	const command = runtime.activeCommand;
	if (command === undefined) {
		return false;
	}
	runtime.activeCommand = undefined;
	runtime.activeWorkItem = undefined;
	const item = runtime.projection.items.get(command.workItemId);
	if (
		item === undefined ||
		item.status === "completed" ||
		item.status === "stalled"
	) {
		return false;
	}
	runtime.queue = [{ ...command, status: "queued" }, ...runtime.queue];
	return true;
}

interface RecoveryOutcome {
	/** restored = snapshot applied plus later events replayed; rebuilt = full replay. */
	readonly mode: "restored" | "rebuilt";
	readonly replayedEventCount: number;
}

/**
 * Recovery per SPEC §15: restore the latest valid snapshot, replay events after the
 * checkpoint, and rebuild every projection from the session event history when the
 * configuration fingerprint changed. Replay runs through the normal post-append
 * pipeline, so projections, automations and queued-command cancellation re-derive
 * deterministically.
 */
export function recoverSessionState(params: {
	readonly runtime: EventLoopRuntime;
	readonly events: readonly LoopEventData[];
	readonly config: EventLoopConfig;
	readonly fingerprint: string;
	readonly snapshot: EventLoopSnapshot | undefined;
	readonly applyEvent: (
		event: LoopEventData,
		config: EventLoopConfig,
		profileName: string,
	) => PostAppendEffects;
}): RecoveryOutcome {
	const { runtime, events, config, fingerprint, snapshot, applyEvent } = params;
	const usable =
		snapshot !== undefined &&
		snapshot.configFingerprint === fingerprint &&
		snapshot.profileName === config.activeProfile;
	if (!usable || snapshot === undefined) {
		return rebuildFromHistory({ runtime, events, config, applyEvent });
	}
	applySnapshotToRuntime(runtime, snapshot);
	requeueActiveCommand(runtime);
	const checkpointId = snapshot.lastAppliedEventId;
	const checkpointIndex =
		checkpointId !== undefined
			? events.findIndex((event) => event.eventId === checkpointId)
			: -1;
	if (checkpointId !== undefined && checkpointIndex === -1) {
		// Checkpoint event is missing from this branch; the snapshot cannot be trusted.
		return rebuildFromHistory({ runtime, events, config, applyEvent });
	}
	const replay =
		checkpointIndex >= 0 ? events.slice(checkpointIndex + 1) : events;
	for (const event of replay) {
		applyEvent(event, config, config.activeProfile);
	}
	return { mode: "restored", replayedEventCount: replay.length };
}

/** Fingerprint change or untrusted snapshot: rebuild every projection from history (SPEC §15). */
function rebuildFromHistory(params: {
	readonly runtime: EventLoopRuntime;
	readonly events: readonly LoopEventData[];
	readonly config: EventLoopConfig;
	readonly applyEvent: (
		event: LoopEventData,
		config: EventLoopConfig,
		profileName: string,
	) => PostAppendEffects;
}): RecoveryOutcome {
	const { runtime, events, config, applyEvent } = params;
	// A fingerprint change invalidates configuration-derived state: projections and
	// commands rebuild from the event history, and automation resumes (SPEC §17).
	// Pause state persists only inside a matching snapshot, never across a rebuild.
	resetEventLoopRuntime(runtime);
	for (const event of events) {
		applyEvent(event, config, config.activeProfile);
	}
	return { mode: "rebuilt", replayedEventCount: events.length };
}
