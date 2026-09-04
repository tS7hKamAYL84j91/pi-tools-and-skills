/** Session lifecycle machinery for pi-event-loop (SPEC §12, §14, §15, §17). */

import type {
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
} from "@earendil-works/pi-coding-agent";
import { createPostAppendPipeline } from "./automator.js";
import { loadEventLoopConfig } from "./config.js";
import {
	commandEmittedOutcome,
	deliverNextCommand,
	settleActiveCommand,
} from "./dispatcher.js";
import { readEventLog } from "./event-log.js";
import { type EventLoopRuntime, resetEventLoopRuntime } from "./runtime.js";
import { buildSnapshot, recoverSessionState } from "./session-state.js";
import { readLatestSnapshot } from "./snapshot-format.js";
import { createTimerRunner, type TimerRunner } from "./timers.js";
import type {
	EventLoopConfig,
	LoopEventData,
	PostAppendPipeline,
} from "./types.js";
import { EVENT_LOOP_EVENT_CUSTOM_TYPE, SNAPSHOT_CUSTOM_TYPE } from "./types.js";

/** Mutable wiring state shared by the lifecycle hooks of one extension instance. */
export interface ExtensionState {
	readonly runtime: EventLoopRuntime;
	readonly pi: ExtensionAPI;
	currentCtx: ExtensionContext | undefined;
	currentConfig: EventLoopConfig | undefined;
	currentFingerprint: string | undefined;
	/** Timers run only while the session is open (SPEC §12). */
	sessionOpen: boolean;
	/** Single-flight guard for the delivery cycle. */
	pumping: boolean;
	/** Monotonic token; a new session start/shutdown invalidates in-flight cycles. */
	generation: number;
	timers: TimerRunner | undefined;
}

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
export function scheduleDeliveryCycle(state: ExtensionState): void {
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
		persistCheckpoint(state);
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

	const config = await prepareConfig(state, ctx);
	if (config === undefined) {
		return;
	}
	restoreSessionState(state, config, ctx);
	startTimers(state, config);
	state.sessionOpen = true;
	scheduleDeliveryCycle(state);
}

/** Load and validate configuration; a missing file keeps the extension inert (SPEC §6). */
async function prepareConfig(
	state: ExtensionState,
	ctx: ExtensionContext,
): Promise<EventLoopConfig | undefined> {
	const result = await loadEventLoopConfig(ctx.cwd);
	if (!result.ok || result.config === undefined) {
		if (!result.missing && result.errors.length > 0) {
			notify(
				state,
				`invalid configuration — ${result.errors.join("; ")}`,
				"error",
			);
		}
		return undefined;
	}
	const profile = result.config.profiles[result.config.activeProfile];
	if (profile === undefined) {
		notify(
			state,
			`active profile "${result.config.activeProfile}" is not defined`,
			"error",
		);
		return undefined;
	}
	state.currentConfig = result.config;
	state.currentFingerprint = result.fingerprint;
	return result.config;
}

/** Restore, replay and rebuild projections per the snapshot fingerprint (SPEC §15). */
function restoreSessionState(
	state: ExtensionState,
	config: EventLoopConfig,
	ctx: ExtensionContext,
): void {
	const entries = ctx.sessionManager.getBranch();
	const events = readEventLog(entries);
	resetEventLoopRuntime(state.runtime);
	recoverSessionState({
		runtime: state.runtime,
		events,
		config,
		fingerprint: state.currentFingerprint ?? "",
		snapshot: readLatestSnapshot(entries),
		applyEvent: createPumpingPipeline(state),
	});
}

function stopTimers(state: ExtensionState): void {
	state.timers?.stop();
	state.timers = undefined;
}

/** Timer catch-up and scheduling: occurrences are facts on the normal append path (SPEC §12). */
function startTimers(state: ExtensionState, config: EventLoopConfig): void {
	const profile = config.profiles[config.activeProfile];
	if (profile === undefined || state.currentFingerprint === undefined) {
		return;
	}
	state.timers = createTimerRunner(
		{
			profileName: config.activeProfile,
			profile,
			limits: config.limits,
			knownEventIds: () =>
				new Set(readEvents(state).map((event) => event.eventId)),
			appendEvent: (event) => {
				state.pi.appendEntry(EVENT_LOOP_EVENT_CUSTOM_TYPE, event);
				createPumpingPipeline(state)(event, config, config.activeProfile);
			},
			notify: (message) => {
				notify(state, message);
			},
			now: () => Date.now(),
			schedule: (callback, delayMs) => {
				const handle = setTimeout(callback, delayMs);
				handle.unref?.();
				return {
					clear: () => {
						clearTimeout(handle);
					},
				};
			},
		},
		state.runtime.timerState,
	);
	state.timers.start();
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
