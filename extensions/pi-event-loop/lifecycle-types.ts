/** Shared lifecycle state shape used by the production transition modules. */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { EventLoopRuntime } from "./runtime.js";
import type { TimerRunner } from "./timers.js";
import type { EventLoopConfig } from "./types.js";

/** Mutable wiring state shared by one extension instance. */
export interface ExtensionState {
	readonly runtime: EventLoopRuntime;
	readonly pi: ExtensionAPI;
	currentCtx: ExtensionContext | undefined;
	currentConfig: EventLoopConfig | undefined;
	currentFingerprint: string | undefined;
	/** Timers run only while the session is open. */
	sessionOpen: boolean;
	/** Single-flight guard for the delivery cycle. */
	pumping: boolean;
	/** Monotonic token invalidating in-flight cycles. */
	generation: number;
	timers: TimerRunner | undefined;
}
