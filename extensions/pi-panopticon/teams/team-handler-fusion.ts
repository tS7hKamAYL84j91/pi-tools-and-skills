/** Fusion protocol handler: bounded panel, judge, synthesis, and fallback. */

import { ok } from "../../../lib/tool-result.js";
import { currentPanopticonRecord } from "./runner.js";
import { resolveTeamSettings } from "./settings.js";
import { bindingForRole, roleBindings } from "./team-bindings.js";
import { nodeDetails, participantsFromRuns, runTeamNode, type NodeRun } from "./team-node-runner.js";
import type { TeamHandler, TeamHandlerResult, TeamHandlerRunArgs, TeamModelSlot } from "./team-handler-shared.js";
import { TEAM_STATUS_KEY, chainText, memberModelSlots, promptChains, recordDetail, recordNode, recordPhase, requireBinding, stoppedResult, stopRequested } from "./team-handler-shared.js";
import type { TeamAgentBinding, TeamModels, TeamSpec } from "./team-types.js";

const DEFAULT_MAX_PANEL_MODELS = 3;
const HARD_MAX_PANEL_MODELS = 4;
const DEFAULT_APPROVAL_CALL_GATE = 4;
const FUSION_PHASE = "fusion";

interface FusionPlanInput {
	configuredPanel: readonly string[];
	configuredJudge?: string;
	configuredFallback?: readonly string[];
	visibleModels?: readonly string[];
	maxPanelModels?: number;
	allowProviders?: readonly string[];
	denyProviders?: readonly string[];
	requireApprovalAboveCalls?: number;
}

interface FusionPlan {
	panel: string[];
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

export function planFusion(args: FusionPlanInput): FusionPlan {
	const warnings: string[] = [];
	const maxPanelModels = boundedPanelLimit(args.maxPanelModels);
	const panel = filterModels(args, args.configuredPanel, warnings, "panel").slice(0, maxPanelModels);
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
		judge,
		fallback,
		warnings,
		estimatedCalls,
		requiresApproval: estimatedCalls > gate,
	};
}

function visibleTextModelIds(args: TeamHandlerRunArgs): string[] | undefined {
	const registry = (args.ctx as { modelRegistry?: { getAvailable?: () => Array<{ provider: string; id: string; input?: string[] }> } }).modelRegistry;
	const available = registry?.getAvailable?.();
	if (!available) return undefined;
	return available.filter((model) => !model.input || model.input.includes("text")).map((model) => `${model.provider}/${model.id}`);
}

function modelPolicy(team: TeamSpec): { allowProviders?: string[]; denyProviders?: string[]; requireApprovalAboveCalls?: number } {
	const policy = (team as unknown as { policy?: { allowProviders?: string[]; denyProviders?: string[]; requireApprovalAboveCalls?: number } }).policy;
	return {
		...(policy?.allowProviders ? { allowProviders: policy.allowProviders } : {}),
		...(policy?.denyProviders ? { denyProviders: policy.denyProviders } : {}),
		...(policy?.requireApprovalAboveCalls !== undefined ? { requireApprovalAboveCalls: policy.requireApprovalAboveCalls } : {}),
	};
}

function fusionModelSlots(team: TeamSpec, models: TeamModels): TeamModelSlot[] {
	return [
		...memberModelSlots({
			count: Math.max(models.members?.length ?? 0, roleBindings(team.agentBindings, ["panel", "member"]).length, 1),
			label: (index) => `Panel model ${index + 1}`,
			models,
		}),
		{ id: "judge", label: "Judge model", current: models.synthesis, kind: "synthesis" },
		{ id: "fallback", label: "Fallback model", current: models.driver, kind: "driver" },
	];
}

function renderJudgePrompt(originalPrompt: string, panelRuns: readonly NodeRun[]): string {
	return [
		"Original prompt:",
		originalPrompt,
		"",
		"Panel responses:",
		participantsFromRuns(panelRuns).map((run, index) => `--- Panel ${index + 1}: ${run.member.model} ---\n${run.output}`).join("\n\n"),
		"",
		"Return structured JSON with keys: consensus, contradictions, partialCoverage, uniqueInsights, blindSpots, confidence, missingEvidence.",
	].join("\n");
}

function renderSynthesisPrompt(originalPrompt: string, panelRuns: readonly NodeRun[], judge: NodeRun | undefined): string {
	return [
		"Original prompt:",
		originalPrompt,
		"",
		judge?.ok ? "Judge analysis:" : "Judge analysis unavailable or invalid; synthesize from panel responses only.",
		judge?.ok ? judge.output : judge?.error ?? "missing",
		"",
		"Panel responses:",
		participantsFromRuns(panelRuns).map((run, index) => `--- Panel ${index + 1}: ${run.member.model} ---\n${run.output}`).join("\n\n"),
		"",
		"Write the final answer. Preserve disagreements and blind spots; do not invent evidence.",
	].join("\n");
}

function isValidJudgeJson(text: string): boolean {
	try {
		const parsed = JSON.parse(text);
		return typeof parsed === "object" && parsed !== null && ("consensus" in parsed || "contradictions" in parsed || "blindSpots" in parsed);
	} catch {
		return false;
	}
}

async function runFallback(input: { args: TeamHandlerRunArgs; binding: TeamAgentBinding; models: readonly string[]; parentId?: string; orchestratorName?: string }): Promise<NodeRun | undefined> {
	for (const [index, model] of input.models.entries()) {
		if (stopRequested(input.args)) return undefined;
		const role = `fallback_${index + 1}`;
		input.args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${input.args.team.id}: ${role}`);
		const node = await runTeamNode({ binding: { ...input.binding, role, label: input.binding.label ?? `Fallback ${index + 1}` }, role, model, prompt: input.args.params.prompt, systemPrompt: "Answer as the reliable fallback model for a failed fusion panel.", ctx: input.args.ctx, signal: input.args.signal, parentId: input.parentId, orchestratorName: input.orchestratorName, timeoutMs: input.args.params.limits?.timeoutMs ?? input.args.team.limits.timeoutMs, maxRetries: input.args.params.limits?.maxRetries ?? input.args.team.limits.maxRetries });
		recordNode(input.args, FUSION_PHASE, node);
		if (node.ok && node.output.trim()) return node;
		recordDetail(input.args, { kind: "fallback", phaseId: FUSION_PHASE, nodeId: role, message: "fusion fallback model failed", data: { model, error: node.error ?? "empty output" } });
	}
	return undefined;
}

async function runFusion(args: TeamHandlerRunArgs): Promise<TeamHandlerResult> {
	if (stopRequested(args)) return stoppedResult(args, []);
	const settings = resolveTeamSettings();
	const panelConfig = args.params.models?.members ?? args.team.models.members ?? settings.defaultMembers;
	const judgeConfig = args.params.models?.synthesis ?? args.team.models.synthesis ?? panelConfig[0];
	const fallbackConfig = args.params.models?.driver ? [args.params.models.driver] : args.team.models.driver ? [args.team.models.driver] : [];
	const plan = planFusion({
		configuredPanel: panelConfig,
		configuredJudge: judgeConfig,
		configuredFallback: fallbackConfig,
		visibleModels: visibleTextModelIds(args),
		maxPanelModels: args.params.limits?.maxLoops ?? args.team.limits.maxLoops ?? DEFAULT_MAX_PANEL_MODELS,
		...modelPolicy(args.team),
	});
	recordPhase(args, FUSION_PHASE);
	recordDetail(args, { kind: "trace", phaseId: FUSION_PHASE, message: "fusion plan selected", data: { panel: plan.panel, judge: plan.judge, fallback: plan.fallback, estimatedCalls: plan.estimatedCalls, requiresApproval: plan.requiresApproval, warnings: plan.warnings } });
	if (plan.requiresApproval) throw new Error(`fusion plan requires approval: estimated ${plan.estimatedCalls} model calls exceeds gate.`);
	const parent = await currentPanopticonRecord(args.ctx.cwd);
	const sourcePanel = roleBindings(args.team.agentBindings, ["panel", "member"]);
	const panelSource = sourcePanel[0] ?? requireBinding(args.team, ["panel", "member"]);
	const judgeSource = bindingForRole(args.team.agentBindings, ["judge", "synthesis"]) ?? requireBinding(args.team, ["judge", "synthesis"]);
	const synthesisSource = bindingForRole(args.team.agentBindings, ["synthesis"]) ?? judgeSource;
	const fallbackSource = bindingForRole(args.team.agentBindings, ["fallback"]) ?? panelSource;
	const panelRuns = await Promise.all(plan.panel.map((model, index) => {
		const source = sourcePanel[index] ?? panelSource;
		const binding = { ...source, role: `panel_${index + 1}`, label: source.label ?? `Panel ${index + 1}`, tools: [] };
		args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: ${binding.role}`);
		return runTeamNode({ binding, role: binding.role, model, prompt: args.params.prompt, systemPrompt: "Answer independently as a fusion panel member. Do not mention other panelists.", ctx: args.ctx, signal: args.signal, parentId: parent?.id, orchestratorName: parent?.name, timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs, maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries });
	}));
	for (const node of panelRuns) recordNode(args, FUSION_PHASE, node);
	let usablePanel = panelRuns.filter((node) => node.ok && node.output.trim());
	const allNodes: NodeRun[] = [...panelRuns];
	if (usablePanel.length === 0) {
		recordDetail(args, { kind: "fallback", phaseId: FUSION_PHASE, message: "all fusion panel models failed; trying sequential fallback", data: { panel: plan.panel } });
		const fallback = await runFallback({ args, binding: fallbackSource, models: plan.fallback, parentId: parent?.id, orchestratorName: parent?.name });
		if (!fallback) return ok("Fusion failed: all panel and fallback models failed.", { team: args.team.id, ok: false, nodes: nodeDetails(allNodes), failureReason: "all_panels_failed" });
		allNodes.push(fallback);
		usablePanel = [fallback];
	}
	if (stopRequested(args)) return stoppedResult(args, allNodes);
	args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: judge`);
	let judge = await runTeamNode({ binding: { ...judgeSource, role: "judge", label: judgeSource.label ?? "Judge", tools: [] }, role: "judge", model: plan.judge, prompt: renderJudgePrompt(args.params.prompt, usablePanel), systemPrompt: chainText(promptChains(args.team, [{ id: "judge.system", kind: "system", defaultPromptId: "fusion/judge/system", roles: ["judge", "synthesis"] }]), "judge.system"), ctx: args.ctx, signal: args.signal, parentId: parent?.id, orchestratorName: parent?.name, timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs, maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries });
	if (judge.ok && !isValidJudgeJson(judge.output)) {
		judge = { ...judge, ok: false, error: "invalid judge JSON" };
		recordDetail(args, { kind: "error", phaseId: FUSION_PHASE, nodeId: "judge", message: "fusion judge returned invalid JSON; synthesis will use raw panel responses" });
	}
	recordNode(args, FUSION_PHASE, judge);
	allNodes.push(judge);
	if (stopRequested(args)) return stoppedResult(args, allNodes);
	args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: synthesis`);
	const synthesis = await runTeamNode({ binding: { ...synthesisSource, role: "synthesis", label: synthesisSource.label ?? "Synthesis", tools: [] }, role: "synthesis", model: plan.judge, prompt: renderSynthesisPrompt(args.params.prompt, usablePanel, judge), systemPrompt: "Produce the final fusion answer from the judge analysis and panel responses.", ctx: args.ctx, signal: args.signal, parentId: parent?.id, orchestratorName: parent?.name, timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs, maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries });
	recordNode(args, FUSION_PHASE, synthesis);
	allNodes.push(synthesis);
	return ok(synthesis.output, { team: args.team.id, ok: allNodes.every((node) => node.ok), nodes: nodeDetails(allNodes), degraded: !judge.ok || panelRuns.some((node) => !node.ok) });
}

export const fusionHandler: TeamHandler = {
	key: "fusion",
	matches(team) {
		return team.protocol === "fusion";
	},
	modelSlots(team, models) {
		return fusionModelSlots(team, models);
	},
	async run(args) {
		return runFusion(args);
	},
};
