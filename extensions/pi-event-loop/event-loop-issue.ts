/** Diagnostic command hatch: queue an operator work item without fabricating a domain event (SPEC §16). */
import { fail, ok, type ToolResult } from "../../lib/tool-result.js";
import { enqueueCommand } from "./command-queue.js";
import type { EventLoopRuntime } from "./runtime.js";
import { activeProfile } from "./status.js";
import type { CommandRecord, EventLoopConfig } from "./types.js";
import { deriveCommandId, deriveWorkItemId } from "./types.js";

export function issueDiagnostic(
	args: readonly string[],
	config: EventLoopConfig,
	runtime: EventLoopRuntime,
): ToolResult {
	const commandType = args[0];
	if (!commandType) {
		return fail("Usage: /event-loop issue <command-type> [json-work-item]", {
			code: "validation",
		});
	}
	const profile = activeProfile(config);
	const command = profile?.commands[commandType];
	if (command === undefined) {
		return fail(`Unknown command type: ${commandType}`, { code: "validation" });
	}
	let workItem: Record<string, unknown> = {};
	if (args[1] !== undefined) {
		try {
			const parsed: unknown = JSON.parse(args.slice(1).join(" "));
			if (
				typeof parsed !== "object" ||
				parsed === null ||
				Array.isArray(parsed)
			) {
				throw new Error("work item must be an object");
			}
			workItem = parsed as Record<string, unknown>;
		} catch (error) {
			return fail(
				`Invalid JSON work item: ${error instanceof Error ? error.message : String(error)}`,
				{ code: "validation" },
			);
		}
	}
	const key =
		typeof workItem["workItemId"] === "string"
			? workItem["workItemId"]
			: `operator:${commandType}:${JSON.stringify(workItem)}`;
	const openingId = `operator-issue:${commandType}:${key}`;
	const workItemId = deriveWorkItemId(
		config.activeProfile,
		"operator-issue",
		key,
		openingId,
	);
	const record: CommandRecord = {
		commandId: deriveCommandId(
			config.activeProfile,
			"operator-issue",
			workItemId,
		),
		type: commandType,
		automationId: "operator-issue",
		workItemId,
		viewId: "operator-issue",
		correlationId: key,
		causedBy: openingId,
		message: command.message,
		expectedEvents: command.expectedEvents,
		workItem,
		status: "queued",
	};
	const queueResult = enqueueCommand(runtime.queue, record, {
		maxPendingCommands: 20,
		maxOpenItemsPerView: 1000,
		maxPayloadBytes: 65536,
		maxChainDepth: 64,
		maxConsecutiveTurns: 64,
		maxRecentEvents: 10000,
	});
	if (!queueResult.ok) {
		return fail(`Diagnostic command rejected: ${queueResult.reason}`, {
			code: "validation",
		});
	}
	runtime.queue = queueResult.queue;
	if (!runtime.projection.items.has(workItemId)) {
		const items = new Map(runtime.projection.items);
		items.set(workItemId, {
			workItemId,
			viewId: "operator-issue",
			key,
			openedByEventId: openingId,
			sourcePayload: workItem,
			status: "outstanding",
		});
		runtime.projection = {
			items,
			order: [...runtime.projection.order, workItemId],
		};
	}
	return ok(
		queueResult.duplicate
			? `Diagnostic command already queued: ${record.commandId}`
			: `Diagnostic command queued: ${record.commandId} (no domain event fabricated).`,
		{
			commandType,
			commandId: record.commandId,
			expectedEvents: command.expectedEvents,
			workItem,
			queued: !queueResult.duplicate,
		},
	);
}
