/**
 * Council member selection, heterogeneity validation, and registry caching.
 *
 * - Provider-family heterogeneity: a council must span ≥2 distinct providers
 *   (openai/, anthropic/, google/, ollama/, ...). Same-family councils are
 *   trivially correlated and undermine the point of multi-model deliberation.
 * - Registry snapshot: capture the available model list at council-formation
 *   time; the live registry can change mid-session, but the council's notion
 *   of "members are real" should be stable.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_CHAIRMAN_CANDIDATES,
	DEFAULT_MEMBER_CANDIDATES,
	resolveCouncilSettings,
} from "./settings.js";

export const COUNCIL_MIN = 3;
export const COUNCIL_MAX = 5;
/** @public */
export const MIN_PROVIDER_FAMILIES = 2;

// ── Heterogeneity ──────────────────────────────────────────────

/** Extract the provider prefix from a model id (`anthropic/claude-...` → `anthropic`). */
export function providerOf(modelId: string): string {
	const slash = modelId.indexOf("/");
	return slash > 0 ? modelId.slice(0, slash) : "unknown";
}

/** @public */
export interface HeterogeneityCheck {
	ok: boolean;
	providers: string[];
	reason?: string;
}

/**
 * A council must span at least MIN_PROVIDER_FAMILIES distinct providers.
 * Returns the providers seen and a reason if the check fails.
 */
export function checkHeterogeneity(modelIds: string[]): HeterogeneityCheck {
	const providers = [...new Set(modelIds.map(providerOf))];
	if (providers.length >= MIN_PROVIDER_FAMILIES) {
		return { ok: true, providers };
	}
	const got = providers.length === 0 ? "(none)" : providers.join(", ");
	return {
		ok: false,
		providers,
		reason: `Council needs ≥${MIN_PROVIDER_FAMILIES} distinct providers; got ${providers.length}: ${got}`,
	};
}

// ── Registry snapshot ──────────────────────────────────────────

/**
 * Read the live registry once and return a stable id set.
 * @public
 */
export function snapshotAvailableModels(ctx: ExtensionContext): string[] {
	try {
		return ctx.modelRegistry
			.getAvailable()
			.map((m) => `${m.provider}/${m.id}`)
			.sort();
	} catch {
		return [];
	}
}

/** Trim, drop blanks, dedupe — preserves first-seen order. */
export function unique(values: string[]): string[] {
	return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function modelMatches(available: Set<string>, model: string): boolean {
	if (available.has(model)) return true;
	if (model.indexOf("/") < 0) {
		return [...available].some(
			(id) => id.endsWith(`/${model}`) || id === model,
		);
	}
	return false;
}

// ── Selection ──────────────────────────────────────────────────

/**
 * Pick member models in priority order:
 *   1. explicit `requested`
 *   2. settings.json defaultMembers (field-level default if absent)
 *   3. hard-coded candidates filtered against the registry snapshot
 *   4. fall back to whatever the snapshot offers
 *
 * @param settingsPath - Optional path to settings.json for hermetic tests.
 */
export function chooseCouncilModels(
	availableSnapshot: string[],
	requested?: string[],
	settingsPath?: string,
): string[] {
	if (requested && requested.length > 0) {
		return unique(requested).slice(0, COUNCIL_MAX);
	}

	const resolved = resolveCouncilSettings(settingsPath);
	if (resolved.defaultMembers.length > 0) {
		const available = new Set(availableSnapshot);
		if (available.size === 0) return resolved.defaultMembers.slice(0, COUNCIL_MIN);
		const matched = resolved.defaultMembers.filter((m) => modelMatches(available, m));
		return matched.length >= COUNCIL_MIN
			? matched.slice(0, COUNCIL_MAX)
			: padFromSnapshot(matched, available);
	}

	const available = new Set(availableSnapshot);
	if (available.size === 0) {
		return DEFAULT_MEMBER_CANDIDATES.slice(0, COUNCIL_MIN);
	}

	const chosen = DEFAULT_MEMBER_CANDIDATES.filter((m) =>
		modelMatches(available, m),
	);
	return chosen.length >= COUNCIL_MIN
		? chosen.slice(0, COUNCIL_MAX)
		: padFromSnapshot(chosen, available);
}

/** Pad a short candidate list with extra models from the registry snapshot. */
function padFromSnapshot(
	chosen: string[],
	available: Set<string>,
): string[] {
	const result = [...chosen];
	for (const model of available) {
		if (result.length >= COUNCIL_MIN) break;
		if (!result.includes(model)) result.push(model);
	}
	return result.slice(0, COUNCIL_MAX);
}

/**
 * Pick the chairman: explicit → settings (if available) → candidate list → members[0].
 *
 * @param settingsPath - Optional path to settings.json for hermetic tests.
 */
export function chooseChairmanModel(
	availableSnapshot: string[],
	members: string[],
	requested?: string,
	settingsPath?: string,
): string {
	if (requested) return requested;
	const resolved = resolveCouncilSettings(settingsPath);
	const available = new Set(availableSnapshot);
	// Use the resolved chairman only if it's available in the registry
	// (or the registry is empty, meaning we can't validate).
	if (
		resolved.defaultChairman &&
		(available.size === 0 || modelMatches(available, resolved.defaultChairman))
	) {
		return resolved.defaultChairman;
	}
	const candidate = DEFAULT_CHAIRMAN_CANDIDATES.find((m) =>
		modelMatches(available, m),
	);
	return (
		candidate ??
		members[0] ??
		DEFAULT_CHAIRMAN_CANDIDATES[0] ??
		"openai-codex/gpt-5.5"
	);
}