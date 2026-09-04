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
import { evaluateEmission } from "./event-ingress.js";
import { readEventLog, type SessionEntryLike } from "./event-log.js";
import {
	canonicalJsonString,
	issueDiagnostic,
	parseJsonObject,
} from "./event-loop-issue.js";
import type { EventLoopRuntime } from "./runtime.js";
import {
	buildStatus,
	formatHistory,
	formatStatus,
	formatViews,
} from "./status.js";
import { markItemOutstanding } from "./todo-view.js";
import type {
	EventLoopConfig,
	LoopEventData,
	PostAppendPipeline,
} from "./types.js";

export interface EventLoopCommandDeps {
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
export async function executeOperatorCommand(
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
			await deps.checkpoint?.(ctx);
			return ok(`pi-event-loop paused: ${deps.runtime.pauseReason}`);
		case "resume":
			deps.runtime.paused = false;
			deps.runtime.pauseReason = undefined;
			await deps.checkpoint?.(ctx);
			await deps.restartPump?.(ctx);
			return ok("pi-event-loop resumed");
		case "retry": {
			const result = retryItem(rest[0], deps.runtime);
			if (!result.isError) {
				await deps.checkpoint?.(ctx);
				await deps.restartPump?.(ctx);
			}
			return result;
		}
		case "reload": {
			if (deps.onReload !== undefined) {
				const reloadOutcome = await deps.onReload(ctx);
				if (reloadOutcome && !reloadOutcome.ok) {
					return fail(
						`pi-event-loop reload failed: ${reloadOutcome.reason ?? "unknown error"}`,
						{ code: "validation" },
					);
				}
			}
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
				await deps.checkpoint?.(ctx);
				await deps.restartPump?.(ctx);
			}
			return useResult;
		}
		case "emit":
			return emitOperatorEvent(rest, ctx, config, deps);
		case "issue": {
			const issueResult = issueDiagnostic(rest, config, deps.runtime);
			if (!issueResult.isError) {
				await deps.checkpoint?.(ctx);
				await deps.restartPump?.(ctx);
			}
			return issueResult;
		}
		default:
			return fail(
				"Usage: /event-loop status|views|history|pause|resume|retry|reload|use|emit|issue",
				{ code: "validation" },
			);
	}
}

function retryItem(
	workItemId: string | undefined,
	runtime: EventLoopRuntime,
): ToolResult {
	if (!workItemId)
		return fail("Usage: /event-loop retry <work-item-id>", {
			code: "validation",
		});
	const item = runtime.projection.items.get(workItemId);
	if (item === undefined)
		return fail(`Unknown work item: ${workItemId}`, { code: "validation" });
	if (item.status !== "stalled")
		return fail(`Work item ${workItemId} is not stalled`, {
			code: "validation",
		});
	runtime.projection = markItemOutstanding(runtime.projection, workItemId);
	runtime.paused = false;
	runtime.pauseReason = undefined;
	return ok(`Retry requested for ${workItemId}; item reopened for automation.`);
}

async function useProfile(
	name: string | undefined,
	config: EventLoopConfig,
	cwd: string,
	writeConfig: EventLoopCommandDeps["writeConfig"],
): Promise<ToolResult> {
	if (!name || config.profiles[name] === undefined)
		return fail(`Unknown profile: ${name ?? ""}`, { code: "validation" });
	if (writeConfig === undefined)
		return fail("Profile switching is unavailable without a config writer", {
			code: "internal",
		});
	await writeConfig(cwd, { ...config, activeProfile: name });
	return ok(`Active profile switched to ${name}`);
}

async function emitOperatorEvent(
	args: readonly string[],
	ctx: ExtensionCommandContext,
	config: EventLoopConfig,
	deps: EventLoopCommandDeps,
): Promise<ToolResult> {
	const eventType = args[0];
	if (!eventType)
		return fail("Usage: /event-loop emit <event-type> [json-payload]", {
			code: "validation",
		});
	let payload: Record<string, unknown> = {};
	if (args[1] !== undefined) {
		const parsed = parseJsonObject(args.slice(1).join(" "));
		if (!parsed.ok) {
			return fail(`Invalid JSON payload: ${parsed.error}`, {
				code: "validation",
			});
		}
		payload = parsed.value;
	}
	const dedupeKey = `${eventType}:${canonicalJsonString(payload)}`;
	const decision = evaluateEmission(
		{
			config,
			profileName: config.activeProfile,
			source: "operator",
			activeCommand: undefined,
			activeWorkItem: undefined,
			knownEventIds: new Set(
				readEventLog(deps.readEntries(ctx)).map((event) => event.eventId),
			),
			now: () => new Date().toISOString(),
		},
		{ event: eventType, dedupeKey, payload },
	);
	if (!decision.ok)
		return fail(`event rejected: ${decision.reason}`, { code: "validation" });
	if (decision.duplicate)
		return ok(`Duplicate event ignored: ${decision.event.eventId}`);
	// Operator emission follows the normal append → project → automate path.
	deps.appendEntry?.(decision.event);
	const effects = deps.pipeline(decision.event, config, config.activeProfile);
	await deps.checkpoint?.(ctx);
	await deps.restartPump?.(ctx);
	return ok(`Event accepted: ${decision.event.eventId}`, {
		eventId: decision.event.eventId,
		...effects,
	});
}
