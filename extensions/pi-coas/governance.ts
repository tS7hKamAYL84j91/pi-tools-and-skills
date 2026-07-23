/**
 * CoAS workload governance logic (input classification and model routing).
 *
 * Pure functions only. Side effects (escalation logging) live in the tool layer.
 */

import { join } from "node:path";
import { readPiSettingsKey, PI_SETTINGS_PATH } from "../../lib/pi-settings.js";
import type {
	GovernanceConfig,
	GovernanceIntent,
	InputClassification,
	ModelResolution,
	ModelRoutingPolicy,
} from "./types.js";

const ALL_INTENTS: GovernanceIntent[] = ["triage", "code", "navigator", "review", "unknown"];

function isGovernanceIntent(value: string): value is GovernanceIntent {
	return ALL_INTENTS.includes(value as GovernanceIntent);
}

function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.filter((item): item is string => typeof item === "string");
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readModelRoutingPolicy(value: unknown): ModelRoutingPolicy | undefined {
	if (!value || typeof value !== "object") return undefined;
	const policy = value as Record<string, unknown>;
	return {
		requiresLocalOnlyForPrivateInput: Boolean(policy.requiresLocalOnlyForPrivateInput),
		localPrivateFallback: optionalString(policy.localPrivateFallback),
		localTriageOnly: optionalString(policy.localTriageOnly),
		gmReviewedSimpleCode: optionalString(policy.gmReviewedSimpleCode),
		navigator: optionalString(policy.navigator),
		advisoryFallbackChain: asStringArray(policy.advisoryFallbackChain),
	};
}

/**
 * Load the GovernanceConfig from `coasProfile` in `.pi/settings.json`.
 * Tries project settings first, then global settings. Read on each call.
 */
export function loadGovernanceConfig(cwd: string = process.cwd()): GovernanceConfig {
	const projectSettingsPath = join(cwd, ".pi", "settings.json");
	let profile = readPiSettingsKey("coasProfile", projectSettingsPath);
	if (!profile) {
		profile = readPiSettingsKey("coasProfile", PI_SETTINGS_PATH);
	}
	if (!profile || typeof profile !== "object") {
		return {};
	}
	const p = profile as Record<string, unknown>;
	const requiresLocalOnlyForPrivateInput = Boolean(p.requiresLocalOnlyForPrivateInput);
	const modelRoutingPolicy = readModelRoutingPolicy(p.modelRoutingPolicy);
	return {
		localOnlyTriggers: asStringArray(p.localOnlyTriggers),
		modelRoutingPolicy: modelRoutingPolicy
			? {
					...modelRoutingPolicy,
					requiresLocalOnlyForPrivateInput:
						modelRoutingPolicy.requiresLocalOnlyForPrivateInput || requiresLocalOnlyForPrivateInput,
				}
			: undefined,
		escalationThresholds:
			p.escalationThresholds && typeof p.escalationThresholds === "object"
				? (p.escalationThresholds as Record<string, number>)
				: undefined,
		requiresLocalOnlyForPrivateInput,
	};
}

function intentPolicyField(intent: GovernanceIntent): keyof Omit<
	ModelRoutingPolicy,
	"requiresLocalOnlyForPrivateInput" | "advisoryFallbackChain"
> | undefined {
	switch (intent) {
		case "triage":
			return "localTriageOnly";
		case "code":
			return "gmReviewedSimpleCode";
		case "navigator":
		case "review":
			return "navigator";
		case "unknown":
			return undefined;
	}
}

/**
 * Classify input as private or public based on substring triggers.
 */
export function classifyInput(text: string, triggers: string[] = []): InputClassification {
	if (!text) {
		return {
			classification: "public",
			matchedTriggers: [],
			reason: "empty input",
		};
	}
	const matchedTriggers: string[] = [];
	const textLower = text.toLowerCase();
	for (const trigger of triggers) {
		if (!trigger) continue;
		if (textLower.includes(trigger.toLowerCase())) {
			matchedTriggers.push(trigger);
		}
	}
	if (matchedTriggers.length > 0) {
		return {
			classification: "private",
			matchedTriggers,
			reason: `matched local-only triggers: ${matchedTriggers.join(", ")}`,
		};
	}
	return {
		classification: "public",
		matchedTriggers: [],
		reason: "no local-only triggers matched",
	};
}

/**
 * Resolve model based on classification, intent, fallback chain, and policy.
 */
export function resolveModel(
	classification: InputClassification,
	intent: GovernanceIntent,
	policy: ModelRoutingPolicy | undefined,
): ModelResolution {
	const chain = policy?.advisoryFallbackChain ?? [];

	if (classification.classification === "private") {
		if (chain.length > 0) {
			return {
				resolvedModel: chain[0],
				source: "advisoryFallbackChain",
				escalate: false,
				reason: "private input routed to first advisory fallback chain entry",
				fallbackChain: chain,
			};
		}
		if (policy?.localPrivateFallback) {
			return {
				resolvedModel: policy.localPrivateFallback,
				source: "localPrivateFallback",
				escalate: false,
				reason: "private input routed to configured local private fallback",
				fallbackChain: [policy.localPrivateFallback],
			};
		}
		return {
			resolvedModel: undefined,
			source: "none",
			escalate: true,
			reason: "private input requires local-only model but none configured",
			fallbackChain: [],
		};
	}

	const field = intentPolicyField(intent);
	if (!field) {
		return {
			resolvedModel: undefined,
			source: "none",
			escalate: false,
			reason: `no policy model for intent '${intent}'`,
			fallbackChain: [],
		};
	}
	const resolved = policy?.[field];
	if (resolved) {
		return {
			resolvedModel: resolved,
			source: "policyIntent",
			escalate: false,
			reason: `public input resolved by intent policy '${field}'`,
			fallbackChain: [],
		};
	}

	return {
		resolvedModel: undefined,
		source: "none",
		escalate: false,
		reason: `no policy model for intent '${intent}'`,
		fallbackChain: [],
	};
}

/**
 * Top-level pure orchestration function.
 */
export function maybeGovernanceRoute(
	input: string,
	intent: GovernanceIntent,
	cwd?: string,
): ModelResolution & { classification: InputClassification } {
	const config = loadGovernanceConfig(cwd);
	const triggers = config.localOnlyTriggers ?? [];
	const classification = classifyInput(input, triggers);
	const resolution = resolveModel(classification, intent, config.modelRoutingPolicy);
	return {
		...resolution,
		classification,
	};
}

/**
 * Normalise an arbitrary intent string to the GovernanceIntent union.
 */
export function normaliseIntent(intent: string | undefined): GovernanceIntent {
	if (intent && isGovernanceIntent(intent)) return intent;
	return "unknown";
}
