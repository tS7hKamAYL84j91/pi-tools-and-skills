/** Pure model selection and call-budget planning for Fusion analysis. */

import type { TeamProfile } from "./team-profiles.js";

const DEFAULT_MAX_PANEL_MODELS = 3;
const HARD_MAX_PANEL_MODELS = 4;
const DEFAULT_APPROVAL_CALL_GATE = 4;

interface FusionPlanInput {
	configuredPanel: readonly string[];
	configuredJudge?: string;
	configuredFallback?: readonly string[];
	visibleModels?: readonly string[];
	maxPanelModels?: number;
	allowProviders?: readonly string[];
	denyProviders?: readonly string[];
	requireApprovalAboveCalls?: number;
	profile?: TeamProfile;
}

interface FusionPlan {
	panel: string[];
	panelSourceIndexes: number[];
	judge: string;
	fallback: string[];
	warnings: string[];
	estimatedCalls: number;
	requiresApproval: boolean;
}

function providerOf(model: string): string {
	return model.split("/")[0] ?? "";
}

function boundedPanelLimit(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_PANEL_MODELS;
	return Math.max(1, Math.min(HARD_MAX_PANEL_MODELS, Math.trunc(value)));
}

function providerAllowed(model: string, allowProviders: readonly string[] | undefined, denyProviders: readonly string[] | undefined): boolean {
	const provider = providerOf(model);
	if (denyProviders?.includes(provider)) return false;
	return !allowProviders || allowProviders.length === 0 || allowProviders.includes(provider);
}

function filterModels(args: FusionPlanInput, models: readonly string[], warnings: string[], label: string): string[] {
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
		if (!out.includes(model)) out.push(model);
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

export function planFusion(args: FusionPlanInput): FusionPlan {
	const warnings: string[] = [];
	const maxPanelModels = boundedPanelLimit(args.maxPanelModels);
	const filteredPanel = filterModels(args, args.configuredPanel, warnings, "panel");
	const orderedPanel = args.profile === "fast" ? providerDiverseModels(filteredPanel) : filteredPanel;
	const panel = orderedPanel.slice(0, maxPanelModels);
	if (panel.length === 0) throw new Error("fusion teams need at least one usable panel model.");
	const firstPanel = panel[0];
	if (!firstPanel) throw new Error("fusion teams need at least one usable panel model.");
	const judgeCandidates = args.configuredJudge ? [args.configuredJudge] : [firstPanel];
	const judge = filterModels(args, judgeCandidates, warnings, "judge")[0] ?? firstPanel;
	const fallback = filterModels(args, args.configuredFallback ?? [], warnings, "fallback");
	const estimatedCalls = panel.length + 1;
	const gate = args.requireApprovalAboveCalls ?? DEFAULT_APPROVAL_CALL_GATE;
	return {
		panel,
		panelSourceIndexes: panel.map((model) => args.configuredPanel.indexOf(model)),
		judge,
		fallback,
		warnings,
		estimatedCalls,
		requiresApproval: estimatedCalls > gate,
	};
}
