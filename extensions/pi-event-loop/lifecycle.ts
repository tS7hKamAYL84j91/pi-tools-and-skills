/** Session lifecycle machinery for pi-event-loop (SPEC §12, §14, §15, §17). */

import type {
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
} from "@earendil-works/pi-coding-agent";
import { createPostAppendPipeline } from "./automator.js";
import { loadEventLoopConfig } from "./config.js";
import { runDeliveryCycle } from "./delivery-cycle.js";
import { readEventLog } from "./event-log.js";
import type { EventLoopRuntime } from "./runtime.js";
import { buildSnapshot, recoverSessionState } from "./session-state.js";
import { readLatestSnapshot } from "./snapshot-format.js";
import { createTimerRunner, type TimerRunner } from "./timers.js";
import type {
	EventLoopConfig,
	LoopEventData,
	PostAppendPipeline,
} from "./types.js";
import { EVENT_LOOP_EVENT_CUSTOM_TYPE, SNAPSHOT_CUSTOM_TYPE } from "./types.js";

/** Settle-poll cadence: ctx.isIdle() && !ctx.hasPendingMessages() (pi 0.74 pattern). */
const SETTLE_POLL_MS = 100;
/** Bound on waiting for a delivered turn to actually start. */
const TURN_START_TIMEOUT_MS = 30_000;
/** Turn settlement may legitimately run long; the next pipeline event re-enters the cycle. */
const SETTLE_TIMEOUT_MS = 3_600_000;

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
 * Single-flight delivery cycle: delivers queued commands and settles each active
 * command via the polling probe. Triggered by session_start and by every accepted
 * event whose pipeline queued work (SPEC §17).
 */
function scheduleDeliveryCycle(state: ExtensionState): void {
	if (!state.sessionOpen || !state.currentConfig || state.pumping) {
		return;
	}
	state.pumping = true;
	const run = state.generation;
	void runDeliveryCycle({
		runtime: state.runtime,
		probe: {
			isIdle: () => state.currentCtx?.isIdle() ?? true,
			hasPendingMessages: () => state.currentCtx?.hasPendingMessages() ?? false,
		},
		sendMessage: (message, options) => {
			state.pi.sendMessage(message, options);
		},
		readEvents: () => readEvents(state),
		persist: () => {
			persistCheckpoint(state);
		},
		limits: state.currentConfig.limits,
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		pollMs: SETTLE_POLL_MS,
		turnStartTimeoutMs: TURN_START_TIMEOUT_MS,
		settleTimeoutMs: SETTLE_TIMEOUT_MS,
		isActive: () => state.generation === run && state.sessionOpen,
	}).catch((error: unknown) => {
		notify(
			state,
			`delivery cycle failed: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
	});
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

export async function handleSessionStart(
	state: ExtensionState,
	ctx: ExtensionContext,
): Promise<void> {
	state.currentCtx = ctx;
	state.generation++;
	state.sessionOpen = false;
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
	resetRuntime(state.runtime);
	recoverSessionState({
		runtime: state.runtime,
		events,
		config,
		fingerprint: state.currentFingerprint ?? "",
		snapshot: readLatestSnapshot(entries),
		applyEvent: createPumpingPipeline(state),
	});
}

function resetRuntime(runtime: EventLoopRuntime): void {
	// Fields are cleared in place: tools and the dispatcher hold this instance.
	Object.assign(runtime, {
		activeCommand: undefined,
		activeWorkItem: undefined,
		projection: { items: new Map(), order: [] },
		queue: [],
		busy: false,
		consecutiveAutomatedTurns: 0,
		paused: false,
		pauseReason: undefined,
		projectedEventCount: 0,
		lastAppliedEventId: undefined,
		timerState: {},
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
	stopTimers(state);
	state.runtime.busy = false;
	persistCheckpoint(state);
}
