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
	type EventLoopConfig,
	EVENT_LOOP_EVENT_CUSTOM_TYPE,
	type PostAppendEffects,
	type PostAppendPipeline,
} from "./types.js";

const EMPTY_EFFECTS: PostAppendEffects = { workItemIds: [], commandIds: [] };

interface EmitToolDeps {
	readonly appendEntry: (customType: string, data?: unknown) => void;
	readonly runtime: EventLoopRuntime;
	readonly loadConfig?: (cwd: string) => Promise<EventLoopConfigResult>;
	readonly getConfig?: (
		cwd: string,
	) => Promise<EventLoopConfigResult> | EventLoopConfigResult;
	readonly pipeline: PostAppendPipeline | undefined;
	/** Overrides the generated description (tests). */
	readonly description?: string;
}

function buildEmitParams(
	config?: EventLoopConfig,
	runtime?: EventLoopRuntime,
) {
	const profile = config ? config.profiles[config.activeProfile] : undefined;
	const activeCommand = runtime?.activeCommand;
	let allowedEvents: string[] = [];
	if (profile !== undefined) {
		if (activeCommand !== undefined) {
			allowedEvents = activeCommand.expectedEvents.filter(
				(name) => profile.events[name]?.allowAgentEmit !== false,
			);
		} else {
			allowedEvents = Object.entries(profile.events)
				.filter(
					([_, spec]) =>
						spec.allowAgentEmit && spec.allowWithoutCommand === true,
				)
				.map(([name]) => name);
		}
	}
	const eventSchema =
		allowedEvents.length === 1
			? Type.Literal(allowedEvents[0]!, {
					description: activeCommand
						? `Expected outcome event for active command "${activeCommand.type}".`
						: "Permitted event without an active command.",
				})
			: allowedEvents.length > 1
				? Type.Union(allowedEvents.map((evt) => Type.Literal(evt)), {
						description: activeCommand
							? `Expected outcome events for active command "${activeCommand.type}".`
							: "Permitted events without an active command.",
					})
				: Type.String({ description: "Event type to emit; must be declared in the active profile." });

	return Type.Object({
		event: eventSchema,
		dedupeKey: Type.String({ description: "Stable idempotency key for this emission; reuse it when retrying." }),
		payload: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
			description: "Event payload with the fields required by the event's contract.",
		})),
	});
}

export function createEmitTool(
	deps: EmitToolDeps,
	config?: EventLoopConfig,
): ToolDefinition<any, Record<string, unknown>> {
	const params = buildEmitParams(config, deps.runtime);
	const description =
		deps.description ??
		(config ? buildDescriptionFromConfig(config, deps.runtime) : DEFAULT_DESCRIPTION);
	return {
		name: "event_loop_emit",
		label: "Event Loop Emit",
		description,
		promptSnippet: "Record a domain fact in the pi-event-loop session event log.",
		parameters: params,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return executeEmission(
				deps,
				params as { event: string; dedupeKey: string; payload?: Record<string, unknown> },
				ctx,
			);
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
	const configResult = deps.getConfig
		? await deps.getConfig(ctx.cwd)
		: deps.loadConfig
			? await deps.loadConfig(ctx.cwd)
			: await loadEventLoopConfig(ctx.cwd);
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

export interface RegisterEmitToolOptions {
	readonly description?: string;
	readonly config?: EventLoopConfig;
	readonly getConfig?: (
		cwd: string,
	) => Promise<EventLoopConfigResult> | EventLoopConfigResult;
}

function formatEventDoc(name: string, spec: { description: string; requiredPayload: readonly string[]; allowWithoutCommand?: boolean }, withContext = false): string {
	const fields = spec.requiredPayload.length > 0 ? spec.requiredPayload.join(", ") : "none";
	const note = withContext && spec.allowWithoutCommand === true ? " (also allowed without an active command)" : "";
	return `- ${name}: ${spec.description} Required payload: ${fields}.${note}`;
}

export function buildDescriptionFromConfig(
	config: EventLoopConfig,
	runtime?: EventLoopRuntime,
): string {
	const profile = config.profiles[config.activeProfile];
	if (profile === undefined) {
		return DEFAULT_DESCRIPTION;
	}
	const lines = ["Emit a domain event to the pi-event-loop session event log.", ""];
	const activeCommand = runtime?.activeCommand;
	if (activeCommand !== undefined) {
		lines.push(
			`Active command: "${activeCommand.type}" (${activeCommand.commandId}).`,
			"Events expected by the active command:",
		);
		for (const eventName of activeCommand.expectedEvents) {
			const spec = profile.events[eventName];
			if (spec?.allowAgentEmit) lines.push(formatEventDoc(eventName, spec));
		}
	} else {
		lines.push("Events you may emit:");
		for (const [eventName, spec] of Object.entries(profile.events)) {
			if (spec.allowAgentEmit) lines.push(formatEventDoc(eventName, spec, true));
		}
	}
	lines.push(
		"",
		"During an active command turn you may only emit that command's expected events; the command message lists them.",
		"Always pass a stable dedupeKey (include the work item id) so retries are idempotent.",
	);
	return lines.join("\n");
}

/** Description generated from the profile active at registration time (SPEC §7). */
export function buildDescriptionFromProfile(
	cwd: string,
	runtime?: EventLoopRuntime,
): string {
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
	return buildDescriptionFromConfig(parsed.config, runtime);
}

/** Register the emit tool with Pi-backed dependencies. */
export function registerEmitTool(
	pi: ExtensionAPI,
	runtime: EventLoopRuntime,
	pipeline: PostAppendPipeline | undefined,
	optionsOrDescription?: string | RegisterEmitToolOptions,
): void {
	const options =
		typeof optionsOrDescription === "string"
			? { description: optionsOrDescription }
			: optionsOrDescription;
	pi.registerTool(
		createEmitTool(
			{
				appendEntry: (customType, data) => pi.appendEntry(customType, data),
				runtime,
				loadConfig: loadEventLoopConfig,
				getConfig: options?.getConfig,
				pipeline,
				description: options?.description,
			},
			options?.config,
		),
	);
}

/** Refresh the emit tool when configuration or active command transitions. */
export function refreshEmitTool(
	pi: ExtensionAPI,
	runtime: EventLoopRuntime,
	pipeline: PostAppendPipeline | undefined,
	optionsOrDescription?: string | RegisterEmitToolOptions,
): void {
	registerEmitTool(pi, runtime, pipeline, optionsOrDescription);
}
