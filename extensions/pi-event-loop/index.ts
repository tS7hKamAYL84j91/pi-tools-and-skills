/** pi-event-loop extension entry point: session-local Event Modeling automation runtime. */

import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import {
	buildDescriptionFromConfig,
	buildDescriptionFromProfile,
	refreshEmitTool,
	registerEmitTool,
	type RegisterEmitToolOptions,
} from "./event-ingress-tool.js";
import { registerEventLoopCommands } from "./event-loop-commands.js";
import { registerContextTool } from "./event-loop-context.js";
import {
	createLifecycleService,
	createPumpingPipeline,
	type ExtensionState,
	handleAgentSettled,
	handleAgentStart,
	handleInput,
	handleSessionShutdown,
	handleSessionStart,
} from "./lifecycle.js";
import { EVENT_LOOP_EVENT_CUSTOM_TYPE, type EventLoopConfig } from "./types.js";
import {
	CONFIG_RELATIVE_PATH,
	type LoadConfigOptions,
	loadEventLoopConfig,
} from "./config.js";
import { createEventLoopRuntime } from "./runtime.js";

function isProjectTrusted(ctx?: unknown): boolean {
	if (
		ctx !== undefined &&
		typeof ctx === "object" &&
		ctx !== null &&
		"isProjectTrusted" in ctx &&
		typeof (ctx as { isProjectTrusted?: () => boolean }).isProjectTrusted ===
			"function"
	) {
		// SAFETY: Narrowed via structural inspection of optional SDK method.
		return (ctx as { isProjectTrusted: () => boolean }).isProjectTrusted();
	}
	return true;
}

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
	const lifecycle = createLifecycleService(state);

	const getConfig = (cwd: string) => {
		if (state.currentConfig !== undefined) {
			return {
				ok: true,
				config: state.currentConfig,
				fingerprint: state.currentFingerprint,
				errors: [],
			};
		}
		// SAFETY: Pi contexts may carry the configured extension directory at runtime.
		const candidate = state.currentCtx as unknown as { configDir?: unknown };
		const options: LoadConfigOptions = {
			trusted: isProjectTrusted(state.currentCtx),
			...(typeof candidate.configDir === "string"
				? { configDir: candidate.configDir }
				: {}),
		};
		return loadEventLoopConfig(cwd, options);
	};

	function refreshDynamicTools(cwd: string): void {
		const config = state.currentConfig;
		const options: RegisterEmitToolOptions = {
			description: config
				? buildDescriptionFromConfig(config, state.runtime)
				: buildDescriptionFromProfile(cwd, state.runtime),
			config,
			getConfig,
		};
		refreshEmitTool(pi, state.runtime, pipeline, options);
	}

	registerEmitTool(pi, state.runtime, pipeline, {
		description: buildDescriptionFromProfile(process.cwd(), state.runtime),
		getConfig,
	});
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
		getConfig,
		checkpoint: () => lifecycle.checkpoint(),
		restartPump: () => lifecycle.restartPump(),
		onReload: async (ctx) => {
			return lifecycle.reload(ctx);
		},
		onProfileSwitched: async (ctx) => {
			await lifecycle.reload(ctx);
		},
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
	pi.on("session_start", async (_event, ctx) => {
		state.currentCtx = ctx;
		if (!isProjectTrusted(ctx)) {
			ctx.ui.notify(
				"pi-event-loop: project is untrusted; extension inert",
				"warning",
			);
			return;
		}
		await handleSessionStart(state, ctx);
		refreshDynamicTools(ctx.cwd);
	});
	pi.on("session_shutdown", () => {
		handleSessionShutdown(state);
	});
}
