/** `/event-loop` operator command surface (SPEC §16). */
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { fail, ok, type ToolResult } from "../../lib/tool-result.js";
import { CONFIG_RELATIVE_PATH, loadEventLoopConfig } from "./config.js";
import { evaluateEmission } from "./event-ingress.js";
import { readEventLog, type SessionEntryLike } from "./event-log.js";
import type { EventLoopRuntime } from "./runtime.js";
import {
	activeProfile,
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
	const configResult = await loadEventLoopConfig(ctx.cwd);
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
		case "status":
			return ok(
				formatStatus(status),
				status as unknown as Record<string, unknown>,
			);
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
			return ok(`pi-event-loop paused: ${deps.runtime.pauseReason}`);
		case "resume":
			deps.runtime.paused = false;
			deps.runtime.pauseReason = undefined;
			return ok("pi-event-loop resumed");
		case "retry":
			return retryItem(rest[0], deps.runtime);
		case "reload":
			return ok(`Configuration reloaded from ${CONFIG_RELATIVE_PATH}`);
		case "use":
			return useProfile(rest[0], config, ctx.cwd, deps.writeConfig);
		case "emit":
			return emitOperatorEvent(rest, ctx, config, deps);
		case "issue":
			return issueDiagnostic(rest, config, deps.runtime);
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
	runtime.paused = false;
	runtime.pauseReason = undefined;
	return ok(
		`Retry requested for ${workItemId}; the next automation scan may reissue it.`,
	);
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
		try {
			const parsed: unknown = JSON.parse(args.slice(1).join(" "));
			if (
				typeof parsed !== "object" ||
				parsed === null ||
				Array.isArray(parsed)
			)
				throw new Error("payload must be an object");
			payload = parsed as Record<string, unknown>;
		} catch (error) {
			return fail(
				`Invalid JSON payload: ${error instanceof Error ? error.message : String(error)}`,
				{ code: "validation" },
			);
		}
	}
	const dedupeKey = `${eventType}:${JSON.stringify(payload)}`;
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
	return ok(`Event accepted: ${decision.event.eventId}`, {
		eventId: decision.event.eventId,
		...effects,
	});
}

function issueDiagnostic(
	args: readonly string[],
	config: EventLoopConfig,
	runtime: EventLoopRuntime,
): ToolResult {
	const commandType = args[0];
	if (!commandType)
		return fail("Usage: /event-loop issue <command-type> [json-work-item]", {
			code: "validation",
		});
	const profile = activeProfile(config);
	const command = profile?.commands[commandType];
	if (command === undefined)
		return fail(`Unknown command type: ${commandType}`, { code: "validation" });
	let workItem: Record<string, unknown> = {};
	if (args[1] !== undefined) {
		try {
			const parsed: unknown = JSON.parse(args.slice(1).join(" "));
			if (
				typeof parsed !== "object" ||
				parsed === null ||
				Array.isArray(parsed)
			)
				throw new Error("work item must be an object");
			workItem = parsed as Record<string, unknown>;
		} catch (error) {
			return fail(
				`Invalid JSON work item: ${error instanceof Error ? error.message : String(error)}`,
				{ code: "validation" },
			);
		}
	}
	// Diagnostic hatch: describe the command without fabricating a domain event.
	return ok(
		`Diagnostic command ${commandType} prepared (no domain event fabricated).`,
		{
			commandType,
			expectedEvents: command.expectedEvents,
			workItem,
			queued: false,
			activeCommand: runtime.activeCommand?.commandId,
		},
	);
}
