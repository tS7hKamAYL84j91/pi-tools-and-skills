/** Session lifecycle machinery for pi-event-loop (SPEC §12, §14, §15, §17). */

import type {
	ExtensionContext,
	InputEvent,
} from "@earendil-works/pi-coding-agent";
import { createPostAppendPipeline } from "./automator.js";
import { loadEventLoopConfig } from "./config.js";
import type { ExtensionState } from "./lifecycle-types.js";
import { buildSnapshot } from "./session-state.js";
import {
	configLoadOptions,
	prepareConfig,
	restoreSessionState,
	startTimers,
	stopTimers,
} from "./lifecycle-state.js";
import {
	commandEmittedOutcome,
	deliverNextCommand,
	settleActiveCommand,
} from "./dispatcher.js";
import { readEventLog } from "./event-log.js";
import type { LoopEventData, PostAppendPipeline } from "./types.js";
import { SNAPSHOT_CUSTOM_TYPE } from "./types.js";

export type { ExtensionState } from "./lifecycle-types.js";

/** Post-append pipeline for one extension instance: project → scan → queue → schedule. */
export function createPumpingPipeline(
	state: ExtensionState,
): PostAppendPipeline {
	const pipeline = createPostAppendPipeline(state.runtime);
	return (event, config, profileName) => {
		const effects = pipeline(event, config, profileName);
		scheduleDeliveryCycle(state);
		return effects;
	};
}

function notify(
	state: ExtensionState,
	message: string,
	type: "info" | "warning" | "error" = "warning",
): void {
	if (!state.currentCtx) {
		return;
	}
	state.currentCtx.ui.notify(`pi-event-loop: ${message}`, type);
}

/** Read the session event log; the session log is the source of truth (SPEC §8). */
function readEvents(state: ExtensionState): readonly LoopEventData[] {
	return state.currentCtx
		? readEventLog(state.currentCtx.sessionManager.getBranch())
		: [];
}

/** Checkpoint the session state (SPEC §11 persists before delivery; §15 on shutdown). */
function persistCheckpoint(state: ExtensionState): void {
	const config = state.currentConfig;
	if (config === undefined || state.currentFingerprint === undefined) {
		return;
	}
	const recentEventIds = readEvents(state)
		.slice(-config.limits.maxRecentEvents)
		.map((event) => event.eventId);
	state.pi.appendEntry(
		SNAPSHOT_CUSTOM_TYPE,
		buildSnapshot({
			runtime: state.runtime,
			config,
			fingerprint: state.currentFingerprint,
			recentEventIds,
		}),
	);
}

/**
 * Single-flight delivery pump: delivers queued commands when idle and settles
 * each active command turn upon agent_settled (SPEC §5, §11, §17).
 */
function scheduleDeliveryCycle(state: ExtensionState): void {
	if (
		!state.sessionOpen ||
		!state.currentConfig ||
		state.pumping ||
		state.runtime.paused ||
		state.runtime.busy ||
		state.runtime.activeCommand !== undefined
	) {
		return;
	}

	const hasQueued = state.runtime.queue.some(
		(record) => record.status === "queued",
	);
	if (!hasQueued) {
		return;
	}

	if (
		state.runtime.consecutiveAutomatedTurns >=
		state.currentConfig.limits.maxConsecutiveTurns
	) {
		state.runtime.paused = true;
		state.runtime.pauseReason = `turn-limit: ${state.runtime.consecutiveAutomatedTurns} consecutive automated turns reached maxConsecutiveTurns ${state.currentConfig.limits.maxConsecutiveTurns}; interactive user input resets the counter`;
		persistCheckpoint(state);
		notify(state, state.runtime.pauseReason, "warning");
		return;
	}

	state.pumping = true;
	const run = state.generation;

	void (async () => {
		try {
			persistCheckpoint(state);
			state.runtime.busy = true;
			const outcome = await deliverNextCommand(
				{
					sendMessage: (message, options) => {
						state.pi.sendMessage(message, options);
					},
				},
				state.runtime,
			);
			if (!outcome.delivered) {
				state.runtime.busy = false;
			} else {
				state.onTransition?.();
			}
		} catch (error: unknown) {
			state.runtime.busy = false;
			const message = error instanceof Error ? error.message : String(error);
			if (state.runtime.activeCommand !== undefined) {
				settleActiveCommand(state.runtime, false);
				state.runtime.pauseReason = `delivery failed: ${message}`;
				persistCheckpoint(state);
			}
			notify(state, `delivery failed: ${message}`, "error");
		} finally {
			state.pumping = false;
			if (
				state.generation === run &&
				state.sessionOpen &&
				!state.runtime.paused &&
				!state.runtime.busy &&
				state.runtime.activeCommand === undefined &&
				state.runtime.queue.some((record) => record.status === "queued")
			) {
				scheduleDeliveryCycle(state);
			}
		}
	})();
}

/** Genuine interactive input resets loop protection; extension turns do not (SPEC §14). */
export function handleInput(state: ExtensionState, event: InputEvent): void {
	if (event.source !== "extension") {
		state.runtime.consecutiveAutomatedTurns = 0;
	}
}

export function handleAgentStart(state: ExtensionState): void {
	state.runtime.busy = true;
}

/** Runtime service owned by the lifecycle, used by operator commands. */
export function createLifecycleService(state: ExtensionState) {
	return {
		checkpoint: () => persistCheckpoint(state),
		restartPump: () => scheduleDeliveryCycle(state),
		reload: async (ctx: ExtensionContext) => {
			const result = await loadEventLoopConfig(ctx.cwd, configLoadOptions(ctx));
			if (!result.ok || result.config === undefined) {
				return {
					ok: false,
					reason: result.missing ? "no configuration" : result.errors.join("; "),
				};
			}
			await handleSessionStart(state, ctx);
			return { ok: true };
		},
	};
}

export function handleAgentSettled(
	state: ExtensionState,
	ctx?: ExtensionContext,
): void {
	if (ctx !== undefined) {
		state.currentCtx = ctx;
	}
	state.runtime.busy = false;

	if (!state.sessionOpen || !state.currentConfig) {
		return;
	}

	const active = state.runtime.activeCommand;
	if (active !== undefined) {
		const expectedEmitted = commandEmittedOutcome(readEvents(state), active);
		const settlement = settleActiveCommand(state.runtime, expectedEmitted);
		if (settlement.stalled) {
			state.runtime.queue = [
				...state.runtime.queue,
				{ ...active, status: "queued" },
			];
		}
		persistCheckpoint(state);
		state.onTransition?.();
		if (settlement.stalled) {
			notify(
				state,
				state.runtime.pauseReason ?? "delivery paused: missing outcome",
				"warning",
			);
			return;
		}
	}

	scheduleDeliveryCycle(state);
}

export async function handleSessionStart(
	state: ExtensionState,
	ctx: ExtensionContext,
): Promise<void> {
	state.currentCtx = ctx;
	state.generation++;
	state.sessionOpen = false;
	state.pumping = false;
	state.runtime.busy = false;
	stopTimers(state);

	const config = await prepareConfig(state, ctx, (message, type) =>
		notify(state, message, type),
	);
	if (config === undefined) {
		return;
	}
	restoreSessionState(state, config, ctx, createPumpingPipeline(state));
	startTimers(
		state,
		config,
		createPumpingPipeline(state),
		(message) => notify(state, message),
	);
	state.sessionOpen = true;
	scheduleDeliveryCycle(state);
}

/** Checkpoint on shutdown; the next session_start restores from it (SPEC §15, §17). */
export function handleSessionShutdown(state: ExtensionState): void {
	state.generation++;
	state.sessionOpen = false;
	state.pumping = false;
	stopTimers(state);
	state.runtime.busy = false;
	persistCheckpoint(state);
}
