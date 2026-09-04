/** Diagnostic command hatch: queue an operator work item without fabricating a domain event (SPEC §16). */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { fail, ok, type ToolResult } from "../../lib/tool-result.js";
import { enqueueCommand } from "./command-queue.js";
import { evaluateEmission } from "./event-ingress.js";
import { readEventLog, type SessionEntryLike } from "./event-log.js";
import type { EventLoopRuntime } from "./runtime.js";
import { activeProfile } from "./status.js";
import { markItemOutstanding } from "./todo-view.js";
import type {
	CommandRecord,
	EventLoopConfig,
	LoopEventData,
	PostAppendEffects,
} from "./types.js";
import { deriveCommandId, deriveWorkItemId } from "./types.js";

/** Parse and validate that a string is a JSON object literal. */
function parseJsonObject(
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
function canonicalJsonString(value: unknown): string {
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

export function retryItem(
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

export async function useProfile(
	name: string | undefined,
	config: EventLoopConfig,
	cwd: string,
	writeConfig?: (cwd: string, config: EventLoopConfig) => Promise<void>,
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

interface EmitOperatorEventDeps {
	readonly readEntries: (ctx: ExtensionCommandContext) => readonly SessionEntryLike[];
	readonly appendEntry?: (event: LoopEventData) => void;
	readonly pipeline: (
		event: LoopEventData,
		config: EventLoopConfig,
		profileName: string,
	) => PostAppendEffects;
	readonly onAfterEmit?: (ctx: ExtensionCommandContext) => Promise<void>;
}

export async function emitOperatorEvent(
	args: readonly string[],
	ctx: ExtensionCommandContext,
	config: EventLoopConfig,
	deps: EmitOperatorEventDeps,
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
	deps.appendEntry?.(decision.event);
	const effects = deps.pipeline(decision.event, config, config.activeProfile);
	await deps.onAfterEmit?.(ctx);
	return ok(`Event accepted: ${decision.event.eventId}`, {
		eventId: decision.event.eventId,
		...effects,
	});
}
