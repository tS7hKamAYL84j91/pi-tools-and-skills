/** pi-event-loop extension entry point: session-local Event Modeling automation runtime. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	buildDescriptionFromProfile,
	registerEmitTool,
} from "./event-ingress-tool.js";
import {
	createPumpingPipeline,
	type ExtensionState,
	handleAgentStart,
	handleInput,
	handleSessionShutdown,
	handleSessionStart,
} from "./lifecycle.js";
import { createEventLoopRuntime } from "./runtime.js";

export default function eventLoopExtension(pi: ExtensionAPI): void {
	const state: ExtensionState = {
		pi,
		runtime: createEventLoopRuntime(),
		currentCtx: undefined,
		currentConfig: undefined,
		currentFingerprint: undefined,
		sessionOpen: false,
		pumping: false,
		generation: 0,
		timers: undefined,
	};

	registerEmitTool(
		pi,
		state.runtime,
		createPumpingPipeline(state),
		buildDescriptionFromProfile(process.cwd()),
	);
	// Genuine interactive input resets loop protection; extension-delivered turns
	// do not (SPEC §14).
	pi.on("input", (event) => {
		handleInput(state, event);
	});
	pi.on("agent_start", () => {
		handleAgentStart(state);
	});
	// session_start restores, replays, catches up timers and delivers (SPEC §17).
	pi.on("session_start", (_event, ctx) => handleSessionStart(state, ctx));
	pi.on("session_shutdown", () => {
		handleSessionShutdown(state);
	});
}
