/** The event_loop_emit tool: Pi tool wiring over the ingress decision logic (SPEC §7). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { fail, ok, type ToolResult } from "../../lib/tool-result.js";
import {
	CONFIG_RELATIVE_PATH,
	type EventLoopConfigResult,
	loadEventLoopConfig,
	parseEventLoopConfig,
} from "./config.js";
import { evaluateEmission } from "./event-ingress.js";
import { readEventLog } from "./event-log.js";
import type { EventLoopRuntime } from "./runtime.js";
import {
	type EmitOutcome,
	EVENT_LOOP_EVENT_CUSTOM_TYPE,
	type PostAppendEffects,
	type PostAppendPipeline,
} from "./types.js";

const EMPTY_EFFECTS: PostAppendEffects = { workItemIds: [], commandIds: [] };

interface EmitToolDeps {
	readonly appendEntry: (customType: string, data?: unknown) => void;
	readonly runtime: EventLoopRuntime;
	readonly loadConfig: (cwd: string) => Promise<EventLoopConfigResult>;
	readonly pipeline: PostAppendPipeline | undefined;
	/** Overrides the generated description (tests). */
	readonly description?: string;
}

const EMIT_PARAMS = Type.Object({
	event: Type.String({
		description: "Event type to emit; must be declared in the active profile.",
	}),
	dedupeKey: Type.String({
		description:
			"Stable idempotency key for this emission; reuse it when retrying.",
	}),
	payload: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description:
				"Event payload with the fields required by the event's contract.",
		}),
	),
});

export function createEmitTool(
	deps: EmitToolDeps,
): ToolDefinition<typeof EMIT_PARAMS, Record<string, unknown>> {
	return {
		name: "event_loop_emit",
		label: "Event Loop Emit",
		description: deps.description ?? DEFAULT_DESCRIPTION,
		promptSnippet:
			"Record a domain fact in the pi-event-loop session event log.",
		parameters: EMIT_PARAMS,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return executeEmission(deps, params, ctx);
		},
	};
}

async function executeEmission(
	deps: EmitToolDeps,
	params: {
		event: string;
		dedupeKey: string;
		payload?: Record<string, unknown>;
	},
	ctx: ExtensionContext,
): Promise<ToolResult> {
	const configResult = await deps.loadConfig(ctx.cwd);
	if (!configResult.ok || configResult.config === undefined) {
		const detail =
			configResult.missing === true
				? `no configuration at ${CONFIG_RELATIVE_PATH}`
				: configResult.errors.join("; ");
		return fail(`pi-event-loop is not usable: ${detail}`, {
			code: "validation",
		});
	}
	const config = configResult.config;
	const knownEventIds = new Set<string>(
		readEventLog(ctx.sessionManager.getBranch()).map((event) => event.eventId),
	);
	const decision = evaluateEmission(
		{
			config,
			profileName: config.activeProfile,
			source: "agent",
			activeCommand: deps.runtime.activeCommand,
			activeWorkItem: deps.runtime.activeWorkItem,
			knownEventIds,
			now: () => new Date().toISOString(),
		},
		{
			event: params.event,
			dedupeKey: params.dedupeKey,
			payload: params.payload,
		},
	);
	if (!decision.ok) {
		return fail(`event rejected: ${decision.reason}`, { code: "validation" });
	}
	if (decision.duplicate) {
		return ok(
			`Duplicate submission ignored; event ${decision.event.eventId} was already accepted.`,
			{
				eventId: decision.event.eventId,
				duplicate: true,
				workItemIds: [],
				commandIds: [],
			},
		);
	}
	// Append before any effects (SPEC §7 step 4).
	deps.appendEntry(EVENT_LOOP_EVENT_CUSTOM_TYPE, decision.event);
	const effects =
		deps.pipeline?.(decision.event, config, config.activeProfile) ??
		EMPTY_EFFECTS;
	const accepted: EmitOutcome = {
		eventId: decision.event.eventId,
		duplicate: false,
		workItemIds: effects.workItemIds,
		commandIds: effects.commandIds,
	};
	return ok(
		`Event ${decision.event.type} accepted (${decision.event.eventId}).`,
		accepted,
	);
}

const DEFAULT_DESCRIPTION =
	"Emit a domain event to the pi-event-loop session event log. The active profile defines which " +
	"events may be emitted and which payload fields they require; event_loop_context reports the live " +
	"contract, and the active command message lists its expected outcome events. With the command-contract " +
	"emission policy, an emitted event must be one of the active command's expected events, or an event " +
	"declared allowWithoutCommand when no command is active.";

/** Description generated from the profile active at registration time (SPEC §7). */
export function buildDescriptionFromProfile(cwd: string): string {
	let text: string;
	try {
		text = readFileSync(join(cwd, CONFIG_RELATIVE_PATH), "utf8");
	} catch {
		return DEFAULT_DESCRIPTION;
	}
	const parsed = parseEventLoopConfig(text);
	if (!parsed.ok || parsed.config === undefined) {
		return DEFAULT_DESCRIPTION;
	}
	const profile = parsed.config.profiles[parsed.config.activeProfile];
	if (profile === undefined) {
		return DEFAULT_DESCRIPTION;
	}
	const lines: string[] = [
		"Emit a domain event to the pi-event-loop session event log.",
		"",
		"Events you may emit:",
	];
	for (const [eventName, spec] of Object.entries(profile.events)) {
		if (!spec.allowAgentEmit) {
			continue;
		}
		const fields =
			spec.requiredPayload.length > 0
				? spec.requiredPayload.join(", ")
				: "none";
		const contextNote =
			spec.allowWithoutCommand === true
				? " (also allowed without an active command)"
				: "";
		lines.push(
			`- ${eventName}: ${spec.description} Required payload: ${fields}.${contextNote}`,
		);
	}
	lines.push(
		"",
		"During an active command turn you may only emit that command's expected events; the command message lists them.",
		"Always pass a stable dedupeKey (include the work item id) so retries are idempotent.",
	);
	return lines.join("\n");
}

/** Register the emit tool with Pi-backed dependencies. */
export function registerEmitTool(
	pi: ExtensionAPI,
	runtime: EventLoopRuntime,
	pipeline: PostAppendPipeline | undefined,
	description?: string,
): void {
	pi.registerTool(
		createEmitTool({
			appendEntry: (customType, data) => pi.appendEntry(customType, data),
			runtime,
			loadConfig: loadEventLoopConfig,
			pipeline,
			description,
		}),
	);
}
