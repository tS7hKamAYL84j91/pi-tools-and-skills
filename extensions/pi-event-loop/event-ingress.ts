/** Event ingress decision logic: validate emissions against the profile and command contract (SPEC §7). */
import type { CommandRecord, EmittedEventInput, EventLoopConfig, EventSource, LoopEventData, ProfileConfig } from "./types.js";
import type { EventLoopRuntime } from "./runtime.js";
import { deriveEventId } from "./types.js";
import { projectionKey } from "./json-pointer.js";

export interface EmissionContext {
	readonly config: EventLoopConfig;
	readonly profileName: string;
	readonly source: EventSource;
	readonly activeCommand: CommandRecord | undefined;
	readonly activeWorkItem: EventLoopRuntime["activeWorkItem"];
	/** Deterministic IDs already present in the log; hits are duplicates. */
	readonly knownEventIds: ReadonlySet<string>;
	/** Injected clock for deterministic tests. */
	readonly now: () => string;
}

type EmissionDecision =
	| {
			readonly ok: true;
			readonly event: LoopEventData;
			readonly duplicate: boolean;
	  }
	| { readonly ok: false; readonly reason: string };

/** Validate an emission against the profile and command contract; no state is mutated here. */
export function evaluateEmission(
	context: EmissionContext,
	input: EmittedEventInput,
): EmissionDecision {
	const profile: ProfileConfig | undefined =
		context.config.profiles[context.profileName];
	if (profile === undefined) {
		return {
			ok: false,
			reason: `profile "${context.profileName}" is not defined`,
		};
	}
	const eventType = input.event;
	if (typeof eventType !== "string" || eventType.length === 0) {
		return { ok: false, reason: "event type must be a non-empty string" };
	}
	const spec = profile.events[eventType];
	if (spec === undefined) {
		return { ok: false, reason: `unknown event "${eventType}"` };
	}

	const contractReason = checkCommandContract(
		context,
		spec.allowAgentEmit,
		spec.allowWithoutCommand === true,
		eventType,
	);
	if (contractReason !== undefined) {
		return { ok: false, reason: contractReason };
	}

	const payload = input.payload ?? {};
	const payloadProblem = validatePayload(
		spec.requiredPayload,
		payload,
		context.config.limits.maxPayloadBytes,
	);
	if (payloadProblem !== undefined) {
		return { ok: false, reason: payloadProblem };
	}

	const correlationProblem = checkCorrelation(
		context,
		profile,
		eventType,
		payload,
	);
	if (correlationProblem !== undefined) {
		return { ok: false, reason: correlationProblem };
	}

	const dedupeKey = input.dedupeKey;
	if (typeof dedupeKey !== "string" || dedupeKey.length === 0) {
		return { ok: false, reason: "dedupeKey must be a non-empty string" };
	}
	const eventId = deriveEventId(context.profileName, eventType, dedupeKey);
	if (context.knownEventIds.has(eventId)) {
		return {
			ok: true,
			event: {
				eventId,
				type: eventType,
				occurredAt: context.now(),
				source: context.source,
				payload,
			},
			duplicate: true,
		};
	}

	const command = context.activeCommand;
	const workItem = context.activeWorkItem;
	const attachCausation = context.source === "agent" && command !== undefined;
	return {
		ok: true,
		duplicate: false,
		event: {
			eventId,
			type: eventType,
			occurredAt: context.now(),
			source: context.source,
			payload,
			...(attachCausation && command !== undefined
				? {
						commandId: command.commandId,
						workItemId: workItem?.workItemId,
						correlationId: workItem?.key,
						causationId: command.commandId,
					}
				: {}),
		},
	};
}

/** Command-contract policy: agent events must be expected events during a command turn, or allowWithoutCommand otherwise. */
function checkCommandContract(
	context: EmissionContext,
	allowAgentEmit: boolean,
	allowWithoutCommand: boolean,
	eventType: string,
): string | undefined {
	if (context.source !== "agent") {
		return undefined;
	}
	const command = context.activeCommand;
	if (command !== undefined) {
		if (!command.expectedEvents.includes(eventType)) {
			return `event "${eventType}" is not one of the active command "${command.type}" expected events (${command.expectedEvents.join(", ")})`;
		}
		return undefined;
	}
	if (!allowAgentEmit) {
		return `event "${eventType}" does not allow agent emission`;
	}
	if (!allowWithoutCommand) {
		return `event "${eventType}" may only be emitted during an active command turn (command-contract policy)`;
	}
	return undefined;
}

function validatePayload(
	requiredPayload: readonly string[],
	payload: Readonly<Record<string, unknown>>,
	maxPayloadBytes: number,
): string | undefined {
	for (const key of requiredPayload) {
		if (!(key in payload)) {
			return `missing required payload key "${key}"`;
		}
	}
	const size = Buffer.byteLength(JSON.stringify(payload) ?? "", "utf8");
	if (size > maxPayloadBytes) {
		return `payload of ${size} bytes exceeds maxPayloadBytes ${maxPayloadBytes}`;
	}
	return undefined;
}

/**
 * SPEC §7: for an active command outcome, the relevant closeOn key must equal the active
 * todo item's key, so one command turn cannot complete unrelated work.
 */
function checkCorrelation(
	context: EmissionContext,
	profile: ProfileConfig,
	eventType: string,
	payload: Readonly<Record<string, unknown>>,
): string | undefined {
	const command = context.activeCommand;
	const item = context.activeWorkItem;
	if (command === undefined || item === undefined) {
		return undefined;
	}
	if (!command.expectedEvents.includes(eventType)) {
		return undefined;
	}
	const view = profile.views[item.viewId];
	if (view === undefined) {
		return undefined;
	}
	const rule = view.closeOn.find((closeRule) => closeRule.event === eventType);
	if (rule === undefined) {
		return undefined;
	}
	const key = projectionKey(payload, rule.keyFrom);
	if (key !== item.key) {
		return `outcome for "${eventType}" points to work item key ${key ?? "none"}, but the active item is "${item.key}"`;
	}
	return undefined;
}
