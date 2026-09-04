/** pi-event-loop extension entry point: session-local Event Modeling automation runtime. */

import { join } from "node:path";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import {
	buildDescriptionFromConfig,
	refreshEmitTool,
	registerEmitTool,
	type RegisterEmitToolOptions,
} from "./event-ingress-tool.js";
import { registerEventLoopCommands } from "./event-loop-commands.js";
import { registerContextTool } from "./event-loop-context.js";
import {
	clearEventLoopStatus,
	openEventLoopInspector,
	setEventLoopStatus,
} from "./event-loop-tui.js";
import { buildStatus } from "./status.js";
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
import {
	COMMAND_MESSAGE_CUSTOM_TYPE,
	EVENT_LOOP_EVENT_CUSTOM_TYPE,
	type EventLoopConfig,
} from "./types.js";
import { type LoadConfigOptions, loadEventLoopConfig } from "./config.js";
import { renderCommandMessage } from "./event-loop-renderers.js";
import { createEventLoopRuntime } from "./runtime.js";

async function writeEventLoopConfig(
	cwd: string,
	config: EventLoopConfig,
): Promise<void> {
	await writeFileAtomic(
		join(cwd, CONFIG_DIR_NAME, "event-loop.json"),
		`${JSON.stringify(config, null, "\t")}\n`,
		{ encoding: "utf8" },
	);
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

	function refreshStatus(): void {
		const ctx = state.currentCtx;
		if (ctx === undefined || !state.sessionOpen || state.currentConfig === undefined) {
			if (ctx !== undefined) clearEventLoopStatus(ctx.ui);
			return;
		}
		const status = buildStatus(state.runtime, state.currentConfig, ctx.sessionManager.getBranch());
		setEventLoopStatus(ctx.ui, {
			paused: status.paused,
			pauseReason: status.pauseReason,
			activeCommandType: status.activeCommand?.type,
			pendingCount: status.pendingCommandCount,
		});
	}

	const getConfig = (cwd: string) => {
		if (state.currentConfig !== undefined) {
			return {
				ok: true,
				config: state.currentConfig,
				fingerprint: state.currentFingerprint,
				errors: [],
			};
		}
		const options: LoadConfigOptions = {
			trusted: state.currentCtx?.isProjectTrusted() ?? false,
			configDir: CONFIG_DIR_NAME,
		};
		return loadEventLoopConfig(cwd, options);
	};

	function refreshDynamicTools(): void {
		const config = state.currentConfig;
		const options: RegisterEmitToolOptions = {
			description: config
				? buildDescriptionFromConfig(config, state.runtime)
				: undefined,
			config,
			getConfig,
		};
		refreshEmitTool(pi, state.runtime, pipeline, options);
	}

	function onTransition(): void {
		refreshDynamicTools();
		refreshStatus();
	}
	state.onTransition = onTransition;

	if (typeof pi.registerMessageRenderer === "function") {
		pi.registerMessageRenderer(
			COMMAND_MESSAGE_CUSTOM_TYPE,
			(message, options, theme) =>
				renderCommandMessage(
					message as { details?: Record<string, unknown>; content?: string },
					options,
					theme,
				),
		);
	}

	registerEmitTool(pi, state.runtime, pipeline, { getConfig });
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
		inspect: async (ctx) => {
			if (state.currentConfig === undefined) return;
			await openEventLoopInspector(
				{ hasUI: ctx.hasUI, mode: ctx.mode, ui: ctx.ui },
				{
					runtime: state.runtime,
					config: state.currentConfig,
					entries: ctx.sessionManager.getBranch(),
				},
			);
		},
		onTransition,
	});
	// Genuine interactive input resets loop protection; extension-delivered turns
	// do not (SPEC §14).
	pi.on("input", (event) => {
		handleInput(state, event);
		onTransition();
	});
	pi.on("agent_start", () => {
		handleAgentStart(state);
		onTransition();
	});
	pi.on("agent_settled", (_event, ctx) => {
		handleAgentSettled(state, ctx);
		onTransition();
	});
	// session_start restores, replays, catches up timers and delivers (SPEC §17).
	pi.on("session_start", async (_event, ctx) => {
		state.currentCtx = ctx;
		if (!ctx.isProjectTrusted()) {
			clearEventLoopStatus(ctx.ui);
			ctx.ui.notify(
				"pi-event-loop: project is untrusted; extension inert",
				"warning",
			);
			return;
		}
		await handleSessionStart(state, ctx);
		onTransition();
	});
	pi.on("session_shutdown", () => {
		handleSessionShutdown(state);
		onTransition();
	});
}
