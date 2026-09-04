/** `/event-loop` operator command surface (SPEC §16). */
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { fail, ok, type ToolResult } from "../../lib/tool-result.js";
import {
	CONFIG_RELATIVE_PATH,
	type EventLoopConfigResult,
	loadEventLoopConfig,
} from "./config.js";
import type { SessionEntryLike } from "./event-log.js";
import {
	emitOperatorEvent,
	issueDiagnostic,
	retryItem,
	useProfile,
} from "./event-loop-issue.js";
import type { EventLoopRuntime } from "./runtime.js";
import {
	buildStatus,
	formatHistory,
	formatStatus,
	formatViews,
} from "./status.js";
import type {
	EventLoopConfig,
	LoopEventData,
	PostAppendPipeline,
} from "./types.js";

interface EventLoopRuntimeSeams {
	readonly checkpoint?: (ctx: ExtensionCommandContext) => Promise<void> | void;
	readonly restartPump?: (ctx: ExtensionCommandContext) => Promise<void> | void;
	readonly onReload?: (
		ctx: ExtensionCommandContext,
	) => Promise<{ ok: boolean; reason?: string } | void>;
	readonly refreshTools?: (cwd?: string) => void;
}

interface EventLoopCommandDeps {
	readonly runtime: EventLoopRuntime;
	readonly pipeline: PostAppendPipeline;
	readonly readEntries: (
		ctx: ExtensionCommandContext,
	) => readonly SessionEntryLike[];
	readonly writeConfig?: (
		cwd: string,
		config: EventLoopConfig,
	) => Promise<void>;
	readonly appendEntry?: (event: LoopEventData) => void;
	readonly getConfig?: (
		cwd: string,
	) => Promise<EventLoopConfigResult> | EventLoopConfigResult;
	readonly onReload?: (
		ctx: ExtensionCommandContext,
	) => Promise<{ ok: boolean; reason?: string } | void>;
	readonly restartPump?: (ctx: ExtensionCommandContext) => Promise<void> | void;
	readonly checkpoint?: (ctx: ExtensionCommandContext) => Promise<void> | void;
	readonly onProfileSwitched?: (
		ctx: ExtensionCommandContext,
		newProfile: string,
	) => Promise<void> | void;
	readonly inspect?: (ctx: ExtensionCommandContext) => Promise<void> | void;
	readonly onTransition?: () => void;
}

function getRuntimeSeams(runtime: EventLoopRuntime): EventLoopRuntimeSeams {
	// SAFETY: EventLoopRuntime is optionally augmented with integration seams for lifecycle controls.
	return runtime as unknown as EventLoopRuntimeSeams;
}

async function invokeCheckpoint(
	deps: EventLoopCommandDeps,
	ctx: ExtensionCommandContext,
): Promise<void> {
	if (deps.checkpoint !== undefined) {
		await deps.checkpoint(ctx);
	} else {
		const seam = getRuntimeSeams(deps.runtime).checkpoint;
		await seam?.(ctx);
	}
}

async function invokeRestartPump(
	deps: EventLoopCommandDeps,
	ctx: ExtensionCommandContext,
): Promise<void> {
	if (deps.restartPump !== undefined) {
		await deps.restartPump(ctx);
	} else {
		const seam = getRuntimeSeams(deps.runtime).restartPump;
		await seam?.(ctx);
	}
}

/** Register `/event-loop` and its explicitly bounded operator subcommands. */
export function registerEventLoopCommands(
	pi: ExtensionAPI,
	deps: EventLoopCommandDeps,
): void {
	pi.registerCommand("event-loop", {
		description: "Inspect and operate the session-local pi-event-loop runtime",
		handler: async (args, ctx) => {
			const result = await executeOperatorCommand(args, ctx, deps);
			deps.onTransition?.();
			if (result !== undefined) {
				ctx.ui.notify(
					result.content[0]?.text ?? "",
					result.isError ? "warning" : "info",
				);
			}
		},
	});
}

/** Execute one operator command without selecting arbitrary agent commands. */
async function executeOperatorCommand(
	args: string,
	ctx: ExtensionCommandContext,
	deps: EventLoopCommandDeps,
): Promise<ToolResult> {
	const [action = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
	const configResult = deps.getConfig
		? await deps.getConfig(ctx.cwd)
		: await loadEventLoopConfig(ctx.cwd);
	if (!configResult.ok || configResult.config === undefined) {
		return fail(
			`pi-event-loop unavailable: ${configResult.missing ? "no configuration" : configResult.errors.join("; ")}`,
			{ code: "validation" },
		);
	}
	const config = configResult.config;
	const entries = deps.readEntries(ctx);
	const status = buildStatus(deps.runtime, config, entries);

	switch (action) {
		case "inspect":
			if (deps.inspect === undefined) {
				return fail("Inspection is unavailable", { code: "internal" });
			}
			await deps.inspect(ctx);
			return ok("Opened pi-event-loop inspection");
		case "status": {
			const details = { ...status };
			return ok(formatStatus(status), details);
		}
		case "views":
			return ok(formatViews(status, rest[0]));
		case "history": {
			const count = rest[0] === undefined ? 20 : Number(rest[0]);
			if (
				!Number.isInteger(count) ||
				count < 0 ||
				count > config.limits.maxRecentEvents
			) {
				return fail("history count must be a non-negative bounded integer", {
					code: "validation",
				});
			}
			return ok(formatHistory(entries, count));
		}
		case "pause":
			deps.runtime.paused = true;
			deps.runtime.pauseReason = rest.join(" ").trim() || "paused by operator";
			await invokeCheckpoint(deps, ctx);
			return ok(`pi-event-loop paused: ${deps.runtime.pauseReason}`);
		case "resume":
			deps.runtime.paused = false;
			deps.runtime.pauseReason = undefined;
			await invokeCheckpoint(deps, ctx);
			await invokeRestartPump(deps, ctx);
			return ok("pi-event-loop resumed");
		case "retry": {
			const result = retryItem(rest[0], deps.runtime);
			if (!result.isError) {
				await invokeCheckpoint(deps, ctx);
				await invokeRestartPump(deps, ctx);
			}
			return result;
		}
		case "reload": {
			let reloadOutcome: { ok: boolean; reason?: string } | void;
			if (deps.onReload !== undefined) {
				reloadOutcome = await deps.onReload(ctx);
			} else {
				const seam = getRuntimeSeams(deps.runtime).onReload;
				reloadOutcome = await seam?.(ctx);
			}
			if (reloadOutcome && !reloadOutcome.ok) {
				return fail(
					`pi-event-loop reload failed: ${reloadOutcome.reason ?? "unknown error"}`,
					{ code: "validation" },
				);
			}
			await invokeCheckpoint(deps, ctx);
			await invokeRestartPump(deps, ctx);
			return ok(`Configuration reloaded from ${CONFIG_RELATIVE_PATH}`);
		}
		case "use": {
			const useResult = await useProfile(
				rest[0],
				config,
				ctx.cwd,
				deps.writeConfig,
			);
			if (!useResult.isError) {
				const target = rest[0];
				if (deps.onProfileSwitched !== undefined && target !== undefined) {
					await deps.onProfileSwitched(ctx, target);
				} else if (deps.onReload !== undefined) {
					await deps.onReload(ctx);
				}
				await invokeCheckpoint(deps, ctx);
				await invokeRestartPump(deps, ctx);
			}
			return useResult;
		}
		case "emit":
			return emitOperatorEvent(rest, ctx, config, {
				readEntries: deps.readEntries,
				appendEntry: deps.appendEntry,
				pipeline: deps.pipeline,
				onAfterEmit: async (c) => {
					await invokeCheckpoint(deps, c);
					await invokeRestartPump(deps, c);
				},
			});
		case "issue": {
			const issueResult = issueDiagnostic(rest, config, deps.runtime);
			if (!issueResult.isError) {
				await invokeCheckpoint(deps, ctx);
				await invokeRestartPump(deps, ctx);
			}
			return issueResult;
		}
		default:
			return fail(
				"Usage: /event-loop status|views|history|pause|resume|retry|reload|use|emit|issue|inspect",
				{ code: "validation" },
			);
	}
}
