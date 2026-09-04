/** pi-event-loop extension entry point: session-local Event Modeling automation runtime. */

import { join } from "node:path";
import { writeFileAtomic } from "../../lib/file-persistence.js";
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
import { registerEventLoopCommands } from "./event-loop-commands.js";
import { registerContextTool } from "./event-loop-context.js";
import { EVENT_LOOP_EVENT_CUSTOM_TYPE, type EventLoopConfig } from "./types.js";
import { CONFIG_RELATIVE_PATH } from "./config.js";
import { createEventLoopRuntime } from "./runtime.js";

async function writeEventLoopConfig(cwd: string, config: EventLoopConfig): Promise<void> {
	await writeFileAtomic(join(cwd, CONFIG_RELATIVE_PATH), `${JSON.stringify(config, null, "\t")}\n`, { encoding: "utf8" });
}

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

	const pipeline = createPumpingPipeline(state);
	registerEmitTool(
		pi,
		state.runtime,
		pipeline,
		buildDescriptionFromProfile(process.cwd()),
	);
	registerContextTool(pi, {
		runtime: state.runtime,
		readEntries: (ctx) => ctx.sessionManager.getBranch(),
	});
	registerEventLoopCommands(pi, {
		runtime: state.runtime,
		pipeline,
		readEntries: (ctx) => ctx.sessionManager.getBranch(),
		appendEntry: (event) => pi.appendEntry(EVENT_LOOP_EVENT_CUSTOM_TYPE, event),
		writeConfig: async (cwd, config) => writeEventLoopConfig(cwd, config),
	});
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
