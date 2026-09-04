/** Diagnostic command hatch: queue an operator work item without fabricating a domain event (SPEC §16). */
import { fail, ok, type ToolResult } from "../../lib/tool-result.js";
import { enqueueCommand } from "./command-queue.js";
import type { EventLoopRuntime } from "./runtime.js";
import { activeProfile } from "./status.js";
import type { CommandRecord, EventLoopConfig } from "./types.js";
import { deriveCommandId, deriveWorkItemId } from "./types.js";

/** Parse and validate that a string is a JSON object literal. */
export function parseJsonObject(
	raw: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return { ok: false, error: "must be a JSON object" };
		}
		return { ok: true, value: parsed as Record<string, unknown> };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** Serialize a value with sorted object keys for deterministic identity hashing. */
export function canonicalJsonString(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((entry) => canonicalJsonString(entry)).join(",")}]`;
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	const entries = keys.map(
		(k) => `${JSON.stringify(k)}:${canonicalJsonString(obj[k])}`,
	);
	return `{${entries.join(",")}}`;
}

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
		const parsed = parseJsonObject(args.slice(1).join(" "));
		if (!parsed.ok) {
			return fail(`Invalid JSON work item: ${parsed.error}`, {
				code: "validation",
			});
		}
		workItem = parsed.value;
	}
	const key =
		typeof workItem["workItemId"] === "string"
			? workItem["workItemId"]
			: `operator:${commandType}:${canonicalJsonString(workItem)}`;
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
	const queueResult = enqueueCommand(runtime.queue, record, config.limits);
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
