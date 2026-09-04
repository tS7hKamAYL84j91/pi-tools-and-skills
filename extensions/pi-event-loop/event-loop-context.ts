/** Read-only model-callable context tool for pi-event-loop (SPEC §16). */
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { fail, ok, type ToolResult } from "../../lib/tool-result.js";
import {
	renderContextCall,
	renderContextResult,
} from "./event-loop-renderers.js";
import { loadEventLoopConfig } from "./config.js";
import type { SessionEntryLike } from "./event-log.js";
import type { EventLoopRuntime } from "./runtime.js";
import { buildStatus } from "./status.js";

interface EventLoopContextDeps {
	readonly runtime: EventLoopRuntime;
	readonly readEntries: (ctx: ExtensionContext) => readonly SessionEntryLike[];
}

const CONTEXT_PARAMS = Type.Object({});

/** Build a read-only event_loop_context tool; execution never mutates runtime state. */
function createContextTool(
	deps: EventLoopContextDeps,
): ToolDefinition<typeof CONTEXT_PARAMS, Record<string, unknown>> {
	return {
		name: "event_loop_context",
		label: "Event Loop Context",
		description:
			"Read-only pi-event-loop context: active command/work item, expected outcome events, pause state, and view rows.",
		promptSnippet:
			"Inspect the current pi-event-loop command contract and view state.",
		parameters: CONTEXT_PARAMS,
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			return executeContext(deps, ctx);
		},
		renderCall: (args, theme, context) => renderContextCall(args, theme, context),
		renderResult: (result, options, theme, context) =>
			renderContextResult(result, options, theme, context),
	};
}

async function executeContext(
	deps: EventLoopContextDeps,
	ctx: ExtensionContext,
): Promise<ToolResult> {
	const result = await loadEventLoopConfig(ctx.cwd);
	if (!result.ok || result.config === undefined) {
		const reason =
			result.missing === true ? "no configuration" : result.errors.join("; ");
		return fail(`pi-event-loop context unavailable: ${reason}`, {
			code: "validation",
		});
	}
	const status = buildStatus(
		deps.runtime,
		result.config,
		deps.readEntries(ctx),
	);
	return ok("Current pi-event-loop context (read-only).", {
		profileName: status.profileName,
		paused: status.paused,
		pauseReason: status.pauseReason,
		busy: status.busy,
		consecutiveAutomatedTurns: status.consecutiveAutomatedTurns,
		activeCommand: status.activeCommand,
		activeWorkItem: status.activeWorkItem,
		pendingCommandCount: status.pendingCommandCount,
		viewRows: status.viewRows,
		eventCount: status.eventCount,
	});
}

/** Register the read-only event_loop_context tool. */
export function registerContextTool(
	pi: ExtensionAPI,
	deps: EventLoopContextDeps,
): void {
	pi.registerTool(createContextTool(deps));
}
