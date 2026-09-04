/** pi-event-loop extension entry point: session-local Event Modeling automation runtime. */

import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import {
	buildDescriptionFromProfile,
	registerEmitTool,
} from "./event-ingress-tool.js";
import {
	createPumpingPipeline,
	type ExtensionState,
	handleAgentSettled,
	handleAgentStart,
	handleInput,
	handleSessionShutdown,
	handleSessionStart,
} from "./lifecycle.js";
import { CONFIG_RELATIVE_PATH } from "./config.js";
import { registerEventLoopCommands } from "./event-loop-commands.js";
import { registerContextTool } from "./event-loop-context.js";
import { createEventLoopRuntime } from "./runtime.js";
import { EVENT_LOOP_EVENT_CUSTOM_TYPE, type EventLoopConfig } from "./types.js";

async function writeEventLoopConfig(
	cwd: string,
	config: EventLoopConfig,
): Promise<void> {
	await writeFileAtomic(
		join(cwd, CONFIG_RELATIVE_PATH),
		`${JSON.stringify(config, null, "\t")}\n`,
		{ encoding: "utf8" },
	);
}

interface AgentSettledEvent {
	readonly type: "agent_settled";
}

/** Compatibility seam for the runtime hook absent from the repository's 0.74 typings. */
interface AgentSettledRegistrar {
	readonly on: (
		event: "agent_settled",
		handler: (event: AgentSettledEvent, ctx: ExtensionContext) => void,
	) => void;
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
	// SAFETY: Pi exposes agent_settled at runtime; its installed 0.74 typings predate that hook.
	(pi as unknown as AgentSettledRegistrar).on(
		"agent_settled",
		(_event, ctx) => {
			handleAgentSettled(state, ctx);
		},
	);
	// session_start restores, replays, catches up timers and delivers (SPEC §17).
	pi.on("session_start", (_event, ctx) => handleSessionStart(state, ctx));
	pi.on("session_shutdown", () => {
		handleSessionShutdown(state);
	});
}
