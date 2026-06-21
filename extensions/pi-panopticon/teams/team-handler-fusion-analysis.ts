/** Fusion-analysis protocol handler: bounded panel + judge returning structured JSON analysis. */

import { ok } from "../../../lib/tool-result.js";
import { currentPanopticonRecord } from "./runner.js";
import { resolveTeamSettings } from "./settings.js";
import { bindingForRole, roleBindings } from "./team-bindings.js";
import { nodeDetails, participantsFromRuns, type NodeRun } from "./team-node-runner.js";
import type { TeamHandler, TeamHandlerResult, TeamHandlerRunArgs, TeamModelSlot } from "./team-handler-shared.js";
import { TEAM_STATUS_KEY, chainText, memberModelSlots, promptChains, recordDetail, recordPhase, requireBinding, runAndRecordNode, stoppedResult, stopRequested } from "./team-handler-shared.js";
import type { TeamAgentBinding, TeamModels, TeamSpec } from "./team-types.js";

const DEFAULT_MAX_PANEL_MODELS = 3;
const HARD_MAX_PANEL_MODELS = 4;
const DEFAULT_APPROVAL_CALL_GATE = 4;
const FUSION_ANALYSIS_PHASE = "fusion-analysis";

const INVALID_JUDGE_FALLBACK = JSON.stringify({
	consensus: [],
	contradictions: [],
	partialCoverage: [],
	uniqueInsights: [],
	blindSpots: ["judge returned invalid JSON"],
	confidence: "low",
	missingEvidence: ["judge analysis unavailable"],
});

interface SharedContext {
	args: TeamHandlerRunArgs;
	plan: FusionPlan;
	parent: { id?: string; name?: string } | undefined;
	panelSource: TeamAgentBinding;
	judgeSource: TeamAgentBinding;
}

interface PanelAndJudgeResult {
	allNodes: NodeRun[];
	judge: NodeRun;
	usablePanel: NodeRun[];
	panelRuns: NodeRun[];
}

async function buildSharedContext(args: TeamHandlerRunArgs): Promise<SharedContext> {
	const parent = await currentPanopticonRecord(args.ctx.cwd);
	const sourcePanel = roleBindings(args.team.agentBindings, ["panel", "member"]);
	const panelSource = sourcePanel[0] ?? requireBinding(args.team, ["panel", "member"]);
	const judgeSource = bindingForRole(args.team.agentBindings, ["judge", "synthesis"]) ?? requireBinding(args.team, ["judge", "synthesis"]);
	return { args, plan: undefined as unknown as FusionPlan, parent, panelSource, judgeSource };
}

async function runPanel(ctx: SharedContext): Promise<{ panelRuns: NodeRun[]; usablePanel: NodeRun[] }> {
	const { args, plan, parent, panelSource } = ctx;
	const panelRuns = await Promise.all(plan.panel.map((model, index) => {
		const source = roleBindings(args.team.agentBindings, ["panel", "member"])[index] ?? panelSource;
		const binding = { ...source, role: `panel_${index + 1}`, label: source.label ?? `Panel ${index + 1}`, tools: [] };
		args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: ${binding.role}`);
		return runAndRecordNode(args, FUSION_ANALYSIS_PHASE, { binding, role: binding.role, model, prompt: args.params.prompt, systemPrompt: "Answer independently as a fusion panel member. Do not mention other panelists.", ctx: args.ctx, signal: args.signal, parentId: parent?.id, orchestratorName: parent?.name, timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs, maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries });
	}));
	const usablePanel = panelRuns.filter((node) => node.ok && node.output.trim());
	return { panelRuns, usablePanel };
}

async function runJudge(ctx: SharedContext, usablePanel: NodeRun[]): Promise<NodeRun> {
	const { args, plan, parent, judgeSource } = ctx;
	if (stopRequested(args)) throw new Error("stop requested");
	args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: judge`);
	return runAndRecordNode(args, FUSION_ANALYSIS_PHASE, { binding: { ...judgeSource, role: "judge", label: judgeSource.label ?? "Judge", tools: [] }, role: "judge", model: plan.judge, prompt: renderJudgePrompt(args.params.prompt, usablePanel), systemPrompt: chainText(promptChains(args.team, [{ id: "judge.system", kind: "system", defaultPromptId: "fusion/judge/system", roles: ["judge", "synthesis"] }]), "judge.system"), ctx: args.ctx, signal: args.signal, parentId: parent?.id, orchestratorName: parent?.name, timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs, maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries });
}

function validateJudgeJson(judge: NodeRun, args: TeamHandlerRunArgs): NodeRun {
	if (!judge.ok || isValidJudgeJson(judge.output)) return judge;
	recordDetail(args, { kind: "error", phaseId: FUSION_ANALYSIS_PHASE, nodeId: "judge", message: "fusion-analysis judge returned invalid JSON", data: { output: judge.output.slice(0, 200) } });
	return { ...judge, ok: false, error: "invalid judge JSON" };
}

async function runPanelAndJudge(args: TeamHandlerRunArgs, plan: FusionPlan): Promise<PanelAndJudgeResult> {
	const ctx = await buildSharedContext(args);
	ctx.plan = plan;
	const { panelRuns, usablePanel } = await runPanel(ctx);
	if (usablePanel.length === 0) {
		return { allNodes: [...panelRuns], judge: undefined as unknown as NodeRun, usablePanel, panelRuns };
	}
	if (stopRequested(args)) return { allNodes: [...panelRuns], judge: undefined as unknown as NodeRun, usablePanel, panelRuns };
	const judge = validateJudgeJson(await runJudge(ctx, usablePanel), args);
	return { allNodes: [...panelRuns, judge], judge, usablePanel, panelRuns };
}

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

function fusionAnalysisModelSlots(team: TeamSpec, models: TeamModels): TeamModelSlot[] {
	return [
		...memberModelSlots({
			count: Math.max(models.members?.length ?? 0, roleBindings(team.agentBindings, ["panel", "member"]).length, 1),
			label: (index) => `Panel model ${index + 1}`,
			models,
		}),
		{ id: "judge", label: "Judge model", current: models.synthesis, kind: "synthesis" },
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

function isValidJudgeJson(text: string): boolean {
	try {
		const parsed = JSON.parse(text);
		return typeof parsed === "object" && parsed !== null && ("consensus" in parsed || "contradictions" in parsed || "blindSpots" in parsed);
	} catch {
		return false;
	}
}

async function runFusionAnalysis(args: TeamHandlerRunArgs): Promise<TeamHandlerResult> {
	if (stopRequested(args)) return stoppedResult(args, []);
	const settings = resolveTeamSettings();
	const panelConfig = args.params.models?.members ?? args.team.models.members ?? settings.defaultMembers;
	const judgeConfig = args.params.models?.synthesis ?? args.team.models.synthesis ?? panelConfig[0];
	const plan = planFusion({
		configuredPanel: panelConfig,
		configuredJudge: judgeConfig,
		configuredFallback: [],
		visibleModels: visibleTextModelIds(args),
		maxPanelModels: args.params.limits?.maxLoops ?? args.team.limits.maxLoops ?? DEFAULT_MAX_PANEL_MODELS,
		...modelPolicy(args.team),
	});
	recordPhase(args, FUSION_ANALYSIS_PHASE);
	recordDetail(args, { kind: "trace", phaseId: FUSION_ANALYSIS_PHASE, message: "fusion-analysis plan selected", data: { panel: plan.panel, judge: plan.judge, estimatedCalls: plan.estimatedCalls, requiresApproval: plan.requiresApproval, warnings: plan.warnings } });
	if (plan.requiresApproval) throw new Error(`fusion-analysis plan requires approval: estimated ${plan.estimatedCalls} model calls exceeds gate.`);
	const { allNodes, judge, usablePanel, panelRuns } = await runPanelAndJudge(args, plan);
	if (usablePanel.length === 0) {
		return ok("Fusion analysis failed: no panel model produced usable output.", { team: args.team.id, ok: false, nodes: nodeDetails(allNodes), failureReason: "all_panels_failed" });
	}
	if (stopRequested(args)) return stoppedResult(args, allNodes);
	const output = judge.ok ? judge.output : INVALID_JUDGE_FALLBACK;
	return ok(output, { team: args.team.id, ok: judge.ok && allNodes.every((node) => node.ok), nodes: nodeDetails(allNodes), analysis: true, degraded: !judge.ok || panelRuns.some((node) => !node.ok), ...(judge.ok ? {} : { failureReason: "invalid_judge_json" }) });
}

export const fusionAnalysisHandler: TeamHandler = {
	key: "fusion-analysis",
	matches(team) {
		return team.protocol === "fusion-analysis";
	},
	modelSlots(team, models) {
		return fusionAnalysisModelSlots(team, models);
	},
	async run(args) {
		return runFusionAnalysis(args);
	},
};
