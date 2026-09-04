/** Configuration, recovery, and timer transitions owned by the event-loop lifecycle. */

import {
	CONFIG_DIR_NAME,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	type LoadConfigOptions,
	loadEventLoopConfig,
} from "./config.js";
import { readEventLog } from "./event-log.js";
import type { ExtensionState } from "./lifecycle-types.js";
import { resetEventLoopRuntime } from "./runtime.js";
import { recoverSessionState } from "./session-state.js";
import { readLatestSnapshot } from "./snapshot-format.js";
import { createTimerRunner } from "./timers.js";
import type { EventLoopConfig, PostAppendPipeline } from "./types.js";
import { EVENT_LOOP_EVENT_CUSTOM_TYPE } from "./types.js";

export function configLoadOptions(ctx: ExtensionContext): LoadConfigOptions {
	return {
		trusted: ctx.isProjectTrusted(),
		configDir: CONFIG_DIR_NAME,
	};
}

export async function prepareConfig(
	state: ExtensionState,
	ctx: ExtensionContext,
	notify: (message: string, type: "info" | "warning" | "error") => void,
): Promise<EventLoopConfig | undefined> {
	const result = await loadEventLoopConfig(ctx.cwd, configLoadOptions(ctx));
	if (!result.ok || result.config === undefined) {
		if (!result.missing && result.errors.length > 0) {
			notify(`invalid configuration — ${result.errors.join("; ")}`, "error");
		}
		return undefined;
	}
	if (result.config.profiles[result.config.activeProfile] === undefined) {
		notify(`active profile "${result.config.activeProfile}" is not defined`, "error");
		return undefined;
	}
	state.currentConfig = result.config;
	state.currentFingerprint = result.fingerprint;
	return result.config;
}

export function restoreSessionState(
	state: ExtensionState,
	config: EventLoopConfig,
	ctx: ExtensionContext,
	pipeline: PostAppendPipeline,
): void {
	const entries = ctx.sessionManager.getBranch();
	resetEventLoopRuntime(state.runtime);
	recoverSessionState({
		runtime: state.runtime,
		events: readEventLog(entries),
		config,
		fingerprint: state.currentFingerprint ?? "",
		snapshot: readLatestSnapshot(entries),
		applyEvent: pipeline,
	});
}

export function stopTimers(state: ExtensionState): void {
	state.timers?.stop();
	state.timers = undefined;
}

export function startTimers(
	state: ExtensionState,
	config: EventLoopConfig,
	pipeline: PostAppendPipeline,
	notify: (message: string) => void,
): void {
	const profile = config.profiles[config.activeProfile];
	if (profile === undefined || state.currentFingerprint === undefined) return;
	const readEvents = () =>
		state.currentCtx ? readEventLog(state.currentCtx.sessionManager.getBranch()) : [];
	state.timers = createTimerRunner(
		{
			profileName: config.activeProfile,
			profile,
			limits: config.limits,
			knownEventIds: () => new Set(readEvents().map((event) => event.eventId)),
			appendEvent: (event) => {
				state.pi.appendEntry(EVENT_LOOP_EVENT_CUSTOM_TYPE, event);
				pipeline(event, config, config.activeProfile);
			},
			notify,
			now: () => Date.now(),
			schedule: (callback, delayMs) => {
				const handle = setTimeout(callback, delayMs);
				handle.unref?.();
				return { clear: () => clearTimeout(handle) };
			},
		},
		state.runtime.timerState,
	);
	state.timers.start();
}
