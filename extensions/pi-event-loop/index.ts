/** pi-event-loop extension entry point: session-local Event Modeling automation runtime. */

import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
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
import { readEventLog } from "./event-log.js";
import {
	type EventLoopRuntimeSeams,
	registerEventLoopCommands,
} from "./event-loop-commands.js";
import { registerContextTool } from "./event-loop-context.js";
import {
	createPumpingPipeline,
	type ExtensionState,
	handleAgentSettled,
	handleAgentStart,
	handleInput,
	handleSessionShutdown,
	handleSessionStart,
} from "./lifecycle.js";
import { buildSnapshot } from "./session-state.js";
import {
	EVENT_LOOP_EVENT_CUSTOM_TYPE,
	type EventLoopConfig,
	SNAPSHOT_CUSTOM_TYPE,
} from "./types.js";
import {
	CONFIG_RELATIVE_PATH,
	type LoadConfigOptions,
	loadEventLoopConfig,
} from "./config.js";
import { createEventLoopRuntime, type EventLoopRuntime } from "./runtime.js";

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

function getRuntimeSeams(runtime: EventLoopRuntime): EventLoopRuntimeSeams {
	// SAFETY: Attaches or retrieves lifecycle seams on the runtime object.
	return runtime as unknown as EventLoopRuntimeSeams;
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
			trusted: isProjectTrusted(state.currentCtx),
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

	function persistCheckpoint(): void {
		const config = state.currentConfig;
		if (config === undefined || state.currentFingerprint === undefined) {
			return;
		}
		const recentEvents = state.currentCtx
			? readEventLog(state.currentCtx.sessionManager.getBranch())
			: [];
		const recentEventIds = recentEvents
			.slice(-config.limits.maxRecentEvents)
			.map((e) => e.eventId);
		pi.appendEntry(
			SNAPSHOT_CUSTOM_TYPE,
			buildSnapshot({
				runtime: state.runtime,
				config,
				fingerprint: state.currentFingerprint,
				recentEventIds,
			}),
		);
	}

	async function runCheckpoint(
		_ctx?: ExtensionCommandContext,
	): Promise<void> {
		const seam = getRuntimeSeams(state.runtime).checkpoint;
		if (seam !== undefined && _ctx !== undefined) {
			await seam(_ctx);
			return;
		}
		persistCheckpoint();
	}

	async function runRestartPump(
		ctx: ExtensionCommandContext,
	): Promise<void> {
		const seam = getRuntimeSeams(state.runtime).restartPump;
		await seam?.(ctx);
	}

	// Expose tool refresh seam on runtime for active-command transitions
	// SAFETY: Augmented runtime provides integration seam.
	(state.runtime as unknown as { refreshTools?: (cwd?: string) => void })
		.refreshTools = (cwd?: string) => {
		const targetCwd = cwd ?? state.currentCtx?.cwd ?? process.cwd();
		refreshDynamicTools(targetCwd);
	};

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
		checkpoint: runCheckpoint,
		restartPump: runRestartPump,
		onReload: async (ctx) => {
			const seam = getRuntimeSeams(state.runtime).onReload;
			if (seam !== undefined) {
				const reloadResult = await seam(ctx);
				if (reloadResult && !reloadResult.ok) {
					return reloadResult;
				}
			}
			const result = await loadEventLoopConfig(ctx.cwd, {
				trusted: isProjectTrusted(ctx),
			});
			if (!result.ok || result.config === undefined) {
				return {
					ok: false,
					reason: result.missing ? "no configuration" : result.errors.join("; "),
				};
			}
			state.currentConfig = result.config;
			state.currentFingerprint = result.fingerprint;
			refreshDynamicTools(ctx.cwd);
			return { ok: true };
		},
		onProfileSwitched: (ctx, newProfile) => {
			if (state.currentConfig?.profiles[newProfile] !== undefined) {
				state.currentConfig = {
					...state.currentConfig,
					activeProfile: newProfile,
				};
				refreshDynamicTools(ctx.cwd);
			}
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
