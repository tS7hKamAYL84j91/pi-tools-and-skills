/** Pure model selection and call-budget planning for Cognitive Boost deliberation. */

import {
	type CognitiveFusionPlan,
	type CognitiveFusionPlanInput,
	DEFAULT_APPROVAL_CALL_GATE,
	DEFAULT_MAX_PANEL_MODELS,
	HARD_MAX_PANEL_MODELS,
	resolveCognitiveProfile,
} from "./cognitive-types.js";

function providerOf(model: string): string {
	return model.split("/")[0] ?? "";
}

function boundedPanelLimit(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) {
		return DEFAULT_MAX_PANEL_MODELS;
	}
	return Math.max(1, Math.min(HARD_MAX_PANEL_MODELS, Math.trunc(value)));
}

function providerAllowed(
	model: string,
	allowProviders: readonly string[] | undefined,
	denyProviders: readonly string[] | undefined,
): boolean {
	const provider = providerOf(model);
	if (denyProviders?.includes(provider)) {
		return false;
	}
	return (
		!allowProviders ||
		allowProviders.length === 0 ||
		allowProviders.includes(provider)
	);
}

function filterModels(
	args: CognitiveFusionPlanInput,
	models: readonly string[],
	warnings: string[],
	label: string,
): string[] {
	const visible = args.visibleModels ? new Set(args.visibleModels) : undefined;
	const out: string[] = [];
	for (const model of models) {
		if (!providerAllowed(model, args.allowProviders, args.denyProviders)) {
			warnings.push(`${label} model filtered by provider policy: ${model}`);
			continue;
		}
		if (visible && !visible.has(model)) {
			warnings.push(`${label} model not visible to pi: ${model}`);
			continue;
		}
		if (!out.includes(model)) {
			out.push(model);
		}
	}
	return out;
}

function providerDiverseModels(models: readonly string[]): string[] {
	const selected: string[] = [];
	const deferred: string[] = [];
	const providers = new Set<string>();
	for (const model of models) {
		const provider = providerOf(model);
		if (providers.has(provider)) {
			deferred.push(model);
		} else {
			providers.add(provider);
			selected.push(model);
		}
	}
	return [...selected, ...deferred];
}

/**
 * Candidate panel models: the explicit configuration when non-empty, otherwise
 * the host registry's visible text models (auto mode, ADR-056).
 */
function resolvePanelCandidates(
	args: CognitiveFusionPlanInput,
	warnings: string[],
): string[] {
	if (args.configuredPanel.length > 0) {
		return filterModels(args, args.configuredPanel, warnings, "panel");
	}
	const visible = filterModels(
		args,
		args.visibleModels ?? [],
		warnings,
		"visible",
	);
	warnings.push(
		`no configured panel models; using ${visible.length} host-visible text model(s)`,
	);
	return visible;
}

/** Plan panel and judge model allocation for a cognitive fusion deliberation. */
export function planCognitiveFusion(
	args: CognitiveFusionPlanInput,
): CognitiveFusionPlan {
	const warnings: string[] = [];
	const profileSettings = resolveCognitiveProfile(args.profile);
	const requestedLimit = args.maxPanelModels ?? profileSettings.panelModels;
	const maxPanelModels = boundedPanelLimit(requestedLimit);
	const panelCandidates = resolvePanelCandidates(args, warnings);
	const orderedPanel =
		args.profile === "fast"
			? providerDiverseModels(panelCandidates)
			: panelCandidates;
	const panel = orderedPanel.slice(0, maxPanelModels);
	if (panel.length === 0) {
		throw new Error(
			"Cognitive boost fusion requires at least one usable panel model.",
		);
	}
	const firstPanel = panel[0];
	if (!firstPanel) {
		throw new Error(
			"Cognitive boost fusion requires at least one usable panel model.",
		);
	}
	const judgeCandidates = args.configuredJudge
		? [args.configuredJudge]
		: [firstPanel];
	const filteredJudgeCandidates = filterModels(
		args,
		judgeCandidates,
		warnings,
		"judge",
	);
	const judge = filteredJudgeCandidates[0] ?? firstPanel;
	const fallback = filterModels(
		args,
		args.configuredFallback ?? [],
		warnings,
		"fallback",
	);
	const estimatedCalls = panel.length + 1;
	const gate = args.requireApprovalAboveCalls ?? DEFAULT_APPROVAL_CALL_GATE;

	return {
		panel,
		panelSourceIndexes: panel.map((model) => orderedPanel.indexOf(model)),
		judge,
		fallback,
		warnings,
		estimatedCalls,
		requiresApproval: estimatedCalls > gate,
	};
}
