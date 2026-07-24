/** Shared CoAS workload classification and model-routing policy. */

import { join } from "node:path";
import { readPiSettingsKey, PI_SETTINGS_PATH } from "./pi-settings.js";

export type GovernanceIntent = "triage" | "code" | "navigator" | "review" | "unknown";

export interface ModelRoutingPolicy {
	requiresLocalOnlyForPrivateInput: boolean;
	localPrivateFallback?: string;
	localTriageOnly?: string;
	gmReviewedSimpleCode?: string;
	navigator?: string;
	advisoryFallbackChain?: string[];
}

export interface GovernanceConfig {
	localOnlyTriggers?: string[];
	modelRoutingPolicy?: ModelRoutingPolicy;
	escalationThresholds?: Record<string, number>;
	requiresLocalOnlyForPrivateInput?: boolean;
}

export interface InputClassification {
	classification: "private" | "public";
	matchedTriggers: string[];
	reason: string;
}

export interface ModelResolution {
	resolvedModel?: string;
	source: "advisoryFallbackChain" | "localPrivateFallback" | "policyIntent" | "none";
	escalate: boolean;
	reason: string;
	fallbackChain?: string[];
}

const ALL_INTENTS: GovernanceIntent[] = ["triage", "code", "navigator", "review", "unknown"];

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

/** Loads project governance settings, falling back to global pi settings. */
export function loadGovernanceConfig(cwd: string = process.cwd()): GovernanceConfig {
	const projectSettingsPath = join(cwd, ".pi", "settings.json");
	let profile = readPiSettingsKey("coasProfile", projectSettingsPath);
	if (!profile) profile = readPiSettingsKey("coasProfile", PI_SETTINGS_PATH);
	if (!profile || typeof profile !== "object") return {};
	const value = profile as Record<string, unknown>;
	const requiresLocalOnlyForPrivateInput = Boolean(value.requiresLocalOnlyForPrivateInput);
	const modelRoutingPolicy = readModelRoutingPolicy(value.modelRoutingPolicy);
	return {
		localOnlyTriggers: asStringArray(value.localOnlyTriggers),
		modelRoutingPolicy: modelRoutingPolicy
			? {
					...modelRoutingPolicy,
					requiresLocalOnlyForPrivateInput:
						modelRoutingPolicy.requiresLocalOnlyForPrivateInput || requiresLocalOnlyForPrivateInput,
				}
			: undefined,
		escalationThresholds:
			value.escalationThresholds && typeof value.escalationThresholds === "object"
				? (value.escalationThresholds as Record<string, number>)
				: undefined,
		requiresLocalOnlyForPrivateInput,
	};
}

/** Classifies text using configured case-insensitive local-only triggers. */
export function classifyInput(text: string, triggers: string[] = []): InputClassification {
	if (!text) return { classification: "public", matchedTriggers: [], reason: "empty input" };
	const lowered = text.toLowerCase();
	const matchedTriggers = triggers.filter(
		(trigger) => trigger.length > 0 && lowered.includes(trigger.toLowerCase()),
	);
	return matchedTriggers.length > 0
		? {
				classification: "private",
				matchedTriggers,
				reason: `matched local-only triggers: ${matchedTriggers.join(", ")}`,
			}
		: { classification: "public", matchedTriggers: [], reason: "no local-only triggers matched" };
}

function intentPolicyField(intent: GovernanceIntent): "localTriageOnly" | "gmReviewedSimpleCode" | "navigator" | undefined {
	if (intent === "triage") return "localTriageOnly";
	if (intent === "code") return "gmReviewedSimpleCode";
	if (intent === "navigator" || intent === "review") return "navigator";
	return undefined;
}

/** Resolves the advisory model for a classification and workload intent. */
export function resolveModel(
	classification: InputClassification,
	intent: GovernanceIntent,
	policy: ModelRoutingPolicy | undefined,
): ModelResolution {
	const chain = policy?.advisoryFallbackChain ?? [];
	if (classification.classification === "private") {
		if (chain[0]) {
			return { resolvedModel: chain[0], source: "advisoryFallbackChain", escalate: false, reason: "private input routed to first advisory fallback chain entry", fallbackChain: chain };
		}
		if (policy?.localPrivateFallback) {
			return { resolvedModel: policy.localPrivateFallback, source: "localPrivateFallback", escalate: false, reason: "private input routed to configured local private fallback", fallbackChain: [policy.localPrivateFallback] };
		}
		return { source: "none", escalate: true, reason: "private input requires local-only model but none configured", fallbackChain: [] };
	}
	const field = intentPolicyField(intent);
	const resolved = field ? policy?.[field] : undefined;
	if (field && resolved) {
		return { resolvedModel: resolved, source: "policyIntent", escalate: false, reason: `public input resolved by intent policy '${field}'`, fallbackChain: [] };
	}
	return { source: "none", escalate: false, reason: `no policy model for intent '${intent}'`, fallbackChain: [] };
}

/** Classifies input and resolves its advisory model in one operation. */
export function maybeGovernanceRoute(
	input: string,
	intent: GovernanceIntent,
	cwd?: string,
): ModelResolution & { classification: InputClassification } {
	const config = loadGovernanceConfig(cwd);
	const classification = classifyInput(input, config.localOnlyTriggers ?? []);
	return { ...resolveModel(classification, intent, config.modelRoutingPolicy), classification };
}

/** Normalises untrusted intent text. */
export function normaliseIntent(intent: string | undefined): GovernanceIntent {
	return intent && ALL_INTENTS.includes(intent as GovernanceIntent)
		? (intent as GovernanceIntent)
		: "unknown";
}
