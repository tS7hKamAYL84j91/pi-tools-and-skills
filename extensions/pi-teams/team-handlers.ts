/**
 * Protocol-specific team execution handlers and model slot metadata.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TeamHandoffRouter, type TeamHandoff, type TeamHandoffTargetCandidate } from "./handoff.js";
import { isLiveAgentRef, liveAgentModel } from "./live-agent.js";
import { renderJoinedSynthesisPrompt, renderPeerCritiquePrompt } from "./protocol-prompts.js";
import { renderTemplate } from "./prompt-renderer.js";
import { resolveSystemPrompt, resolveTemplatePrompt, type PromptCatalog, type ResolvedPromptChain } from "./prompt-resolver.js";
import { currentPanopticonRecord } from "./runner.js";
import { resolveTeamSettings } from "./settings.js";
import type { TeamStateManager } from "./state.js";
import { bindingForRole, roleBindings } from "./team-bindings.js";
import { nodeDetails, type NodeRun, participantsFromRuns, runTeamNode } from "./team-node-runner.js";
import type { TeamAgentBinding, TeamModelSlotSpec, TeamModels, TeamPromptRefs, TeamSpec } from "./team-types.js";
import type { TeamParticipant } from "./types.js";

export const TEAM_STATUS_KEY = "team";

export interface TeamRunModels {
	members?: string[];
	synthesis?: string;
	driver?: string;
	navigator?: string;
}

export interface TeamRunLimits {
	maxFixPasses?: number;
	timeoutMs?: number;
	maxRetries?: number;
	maxLoops?: number;
}

export interface TeamRunInput {
	id: string;
	prompt: string;
	files?: string[];
	specPath?: string;
	models?: TeamRunModels;
	limits?: TeamRunLimits;
	async?: boolean;
}

export interface TeamModelSlot {
	id: string;
	label: string;
	current?: string;
	kind: "member" | "synthesis" | "driver" | "navigator";
	index?: number;
}

interface TeamHandlerResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

interface TeamHandlerRunArgs {
	team: TeamSpec;
	params: TeamRunInput;
	ctx: ExtensionContext;
	stateManager: TeamStateManager;
	runId?: string;
	signal?: AbortSignal;
}

interface TeamHandler {
	key: string;
	matches(team: TeamSpec): boolean;
	modelSlots(team: TeamSpec, models: TeamModels): TeamModelSlot[];
	run(args: TeamHandlerRunArgs): Promise<TeamHandlerResult>;
}

interface PromptSlot {
	id: string;
	kind: "system" | "template";
	defaultPromptId: string;
	roles?: string[];
}

function okText(text: string, details: Record<string, unknown>): TeamHandlerResult {
	return { content: [{ type: "text", text }], details };
}

function memberModelSlots(args: {
	count: number;
	label: (index: number) => string;
	models: TeamModels;
}): TeamModelSlot[] {
	return Array.from({ length: args.count }, (_value, index) => ({
		id: `member:${index}`,
		label: args.label(index),
		current: args.models.members?.[index],
		kind: "member" as const,
		index,
	}));
}

function recordPhase(args: TeamHandlerRunArgs, phaseId: string, label = phaseId): void {
	if (args.runId) args.stateManager.recordPhaseStarted(args.runId, phaseId, label);
}

function recordDetail(args: TeamHandlerRunArgs, detail: { kind: "trace" | "handoff" | "fallback" | "artifact" | "error"; message: string; phaseId?: string; nodeId?: string; data?: Record<string, unknown> }): void {
	if (args.runId) args.stateManager.recordDetail(args.runId, detail);
}

function recordHandoff(args: TeamHandlerRunArgs, router: TeamHandoffRouter, handoff: TeamHandoff): void {
	const route = router.route(handoff);
	recordDetail(args, {
		kind: "handoff",
		phaseId: route.handoff.phaseId,
		nodeId: route.target.nodeId,
		message: route.handoff.message,
		...(route.handoff.data ? { data: route.handoff.data } : {}),
	});
}

function recordNode(args: TeamHandlerRunArgs, phaseId: string, node: NodeRun): void {
	if (!args.runId) return;
	args.stateManager.recordNodeCompleted(args.runId, {
		phaseId,
		nodeId: node.role,
		role: node.binding.role,
		model: node.model,
		ok: node.ok,
		durationMs: node.durationMs,
		output: node.output,
		...(node.error ? { error: node.error } : {}),
	});
}

function currentModelForSlot(slot: TeamModelSlotSpec, models: TeamModels, index: number): string | undefined {
	if (slot.kind === "member") return models.members?.[index];
	return models[slot.kind];
}

function manifestModelSlots(team: TeamSpec, models: TeamModels): TeamModelSlot[] | undefined {
	if (!team.modelSlots) return undefined;
	const slots: TeamModelSlot[] = [];
	for (const slot of team.modelSlots) {
		const count = slot.count === "dynamic" ? Math.max(models.members?.length ?? 0, team.agentBindings.length, 1) : slot.count ?? 1;
		for (let index = 0; index < count; index++) {
			slots.push({
				id: count === 1 ? slot.id : `${slot.id}:${index}`,
				label: slot.label ?? (count === 1 ? slot.id : `${slot.id} ${index + 1}`),
				current: currentModelForSlot(slot, models, index),
				kind: slot.kind,
				...(slot.kind === "member" ? { index } : {}),
			});
		}
	}
	return slots;
}

function roleMatches(role: string, candidates: readonly string[]): boolean {
	const normalized = role.toLowerCase().replaceAll("-", "_");
	return candidates.some((candidate) => normalized === candidate || normalized.startsWith(`${candidate}_`));
}

function promptRefsWithAliases(team: TeamSpec): TeamPromptRefs {
	return {
		...team.prompts,
		...(team.prompts["navigator.template"] === undefined && team.prompts["node.template"] !== undefined ? { "navigator.template": team.prompts["node.template"] } : {}),
	};
}

function bindingForPromptSlot(team: TeamSpec, slot: PromptSlot): TeamAgentBinding | undefined {
	return slot.roles ? team.agentBindings.find((binding) => roleMatches(binding.role, slot.roles ?? [])) : undefined;
}

function resolvePromptSlot(team: TeamSpec, catalog: PromptCatalog, slot: PromptSlot): ResolvedPromptChain {
	const args = {
		teamPrompts: promptRefsWithAliases(team),
		binding: bindingForPromptSlot(team, slot),
		slot: slot.id,
		defaultPromptId: slot.defaultPromptId,
		catalog,
	};
	return slot.kind === "system" ? resolveSystemPrompt(args) : resolveTemplatePrompt(args);
}

function requireBinding(team: TeamSpec, roles: string[]): TeamAgentBinding {
	const binding = bindingForRole(team.agentBindings, roles) ?? team.agentBindings[0];
	if (!binding) throw new Error(`Team "${team.id}" needs at least one role binding.`);
	return binding;
}

function councilSlots(team: TeamSpec): PromptSlot[] {
	if (team.protocol === "consult") {
		return [
			{ id: "navigator.system", kind: "system", defaultPromptId: "consult/navigator/system", roles: ["navigator"] },
			{ id: "navigator.template", kind: "template", defaultPromptId: "consult/navigator/template", roles: ["navigator"] },
		];
	}
	return [
		{ id: "generation.system", kind: "system", defaultPromptId: "debate/generation/system", roles: ["member"] },
		{ id: "critique.system", kind: "system", defaultPromptId: "debate/critique/system", roles: ["critic"] },
		{ id: "critique.template", kind: "template", defaultPromptId: "debate/critique/template", roles: ["critic"] },
		{ id: "synthesis.system", kind: "system", defaultPromptId: "debate/synthesis/system", roles: ["synthesis"] },
		{ id: "synthesis.template", kind: "template", defaultPromptId: "debate/synthesis/template", roles: ["synthesis"] },
	];
}



function promptChains(team: TeamSpec, slots: readonly PromptSlot[]): ResolvedPromptChain[] {
	const catalog = resolveTeamSettings().prompts;
	return slots.map((slot) => resolvePromptSlot(team, catalog, slot));
}

function chainText(chains: readonly ResolvedPromptChain[], slot: string): string {
	const chain = chains.find((entry) => entry.slot === slot);
	if (!chain) throw new Error(`Protocol prompt slot "${slot}" was not resolved.`);
	return chain.text;
}

const councilHandler: TeamHandler = {
	key: "council",
	matches(team) {
		return team.protocol === "council" || team.protocol === "consult" || team.protocol === "debate";
	},
	modelSlots(team, models) {
		if (team.protocol === "consult") return [{ id: "navigator", label: "Navigator model", current: models.navigator, kind: "navigator" }];
		return [
			...memberModelSlots({
				count: Math.max(models.members?.length ?? 0, roleBindings(team.agentBindings, ["member"]).length, 1),
				label: (index) => `Member model ${index + 1}`,
				models,
			}),
			{ id: "synthesis", label: "Synthesis model", current: models.synthesis, kind: "synthesis" },
		];
	},
	async run(args) {
		return args.team.protocol === "consult" ? runConsult(args) : runDebate(args);
	},
};

async function runConsult(args: TeamHandlerRunArgs): Promise<TeamHandlerResult> {
	const settings = resolveTeamSettings();
	const binding = requireBinding(args.team, ["navigator"]);
	const model = args.params.models?.navigator ?? args.team.models.navigator ?? (isLiveAgentRef(binding.subagent) ? liveAgentModel(binding.subagent) : settings.defaultConsult?.navigator);
	recordDetail(args, { kind: "trace", phaseId: "consult", nodeId: "navigator", message: "consult navigator selected", data: { role: binding.role, model } });
	if (!model) throw new Error("consult teams need a navigator model or live-agent binding.");
	const chains = promptChains(args.team, councilSlots(args.team));
	const parent = await currentPanopticonRecord(args.ctx.cwd);
	recordPhase(args, "consult");
	args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: consult navigator`);
	const node = await runTeamNode({
		binding: { ...binding, role: "navigator" },
		role: "navigator",
		model,
		prompt: renderTemplate(chainText(chains, "navigator.template").split("\n"), { prompt: args.params.prompt }),
		systemPrompt: chainText(chains, "navigator.system"),
		ctx: args.ctx,
		parentId: parent?.id,
		orchestratorName: parent?.name,
		timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs,
		maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries,
	});
	recordNode(args, "consult", node);
	return okText(node.output, { team: args.team.id, ok: node.ok, nodes: nodeDetails([node]) });
}

function stopRequested(args: TeamHandlerRunArgs): boolean {
	return args.runId !== undefined && args.stateManager.isStopRequested(args.runId);
}

function stopReason(args: TeamHandlerRunArgs): string {
	return args.runId ? args.stateManager.stopReason(args.runId) ?? "stop requested" : "stop requested";
}

function stoppedResult(args: TeamHandlerRunArgs, nodes: readonly NodeRun[]): TeamHandlerResult {
	return okText(`Team run stopped: ${stopReason(args)}`, { team: args.team.id, ok: false, stopped: true, reason: stopReason(args), nodes: nodeDetails(nodes) });
}

function boundedLoopCount(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return 2;
	return Math.max(1, Math.min(Math.trunc(value), 5));
}

async function runDebate(args: TeamHandlerRunArgs): Promise<TeamHandlerResult> {
	const settings = resolveTeamSettings();
	const memberModels = args.params.models?.members ?? args.team.models.members ?? settings.defaultMembers;
	if (memberModels.length === 0) throw new Error("debate teams need at least one member model.");
	const explicitSynthesis = args.params.models?.synthesis ?? args.team.models.synthesis ?? settings.defaultSynthesis;
	const synthesisModel = explicitSynthesis ?? memberModels[0];
	if (!explicitSynthesis && synthesisModel) recordDetail(args, { kind: "fallback", phaseId: "debate", nodeId: "synthesis", message: "debate synthesis model fell back to first member model", data: { model: synthesisModel } });
	if (!synthesisModel) throw new Error("debate teams need a synthesis model.");
	const chains = promptChains(args.team, councilSlots(args.team));
	const parent = await currentPanopticonRecord(args.ctx.cwd);
	const sourceMembers = roleBindings(args.team.agentBindings, ["member"]);
	const memberSource = sourceMembers[0] ?? requireBinding(args.team, ["member"]);
	const criticSource = bindingForRole(args.team.agentBindings, ["critic"]) ?? memberSource;
	const synthesisSource = bindingForRole(args.team.agentBindings, ["synthesis"]) ?? requireBinding(args.team, ["synthesis"]);
	const handoffRouter = new TeamHandoffRouter([{ nodeId: "synthesis", binding: synthesisSource, model: synthesisModel }]);
	recordPhase(args, "debate");
	const generation = await Promise.all(memberModels.map((model, index) => {
		const source = sourceMembers[index] ?? memberSource;
		const binding = { ...source, role: `generation_${index + 1}`, label: source.label ?? `Member ${index + 1}` };
		args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: ${binding.role}`);
		return runTeamNode({ binding, role: binding.role, model, prompt: args.params.prompt, systemPrompt: chainText(chains, "generation.system"), ctx: args.ctx, parentId: parent?.id, orchestratorName: parent?.name, timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs, maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries });
	}));
	for (const node of generation) recordNode(args, "debate", node);
	const members: TeamParticipant[] = generation.map((node) => ({ label: node.binding.label ?? node.role, model: node.model }));
	const okGeneration = participantsFromRuns(generation.filter((node) => node.ok));
	const critiques = await Promise.all(memberModels.map((model, index) => {
		const binding = { ...criticSource, role: `critique_${index + 1}`, label: generation[index]?.binding.label ?? `Member ${index + 1}` };
		const prompt = renderPeerCritiquePrompt({ originalPrompt: args.params.prompt, generation: okGeneration, members, viewer: { label: binding.label ?? binding.role, model }, template: chainText(chains, "critique.template").split("\n") });
		args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: ${binding.role}`);
		return runTeamNode({ binding, role: binding.role, model, prompt, systemPrompt: chainText(chains, "critique.system"), ctx: args.ctx, parentId: parent?.id, orchestratorName: parent?.name, timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs, maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries });
	}));
	for (const node of critiques) recordNode(args, "debate", node);
	recordHandoff(args, handoffRouter, {
		phaseId: "debate",
		fromNodeId: "critique_aggregate",
		target: { type: "node", nodeId: "synthesis" },
		message: "debate generation and critique outputs handed to synthesis",
		data: { generation: generation.length, critiques: critiques.length },
	});
	const synthesisPrompt = renderJoinedSynthesisPrompt({ originalPrompt: args.params.prompt, generation: okGeneration, critiques: participantsFromRuns(critiques.filter((node) => node.ok)), members, template: chainText(chains, "synthesis.template").split("\n") });
	const synthesis = await runTeamNode({ binding: { ...synthesisSource, role: "synthesis", label: synthesisSource.label ?? "Synthesis" }, role: "synthesis", model: synthesisModel, prompt: synthesisPrompt, systemPrompt: chainText(chains, "synthesis.system"), ctx: args.ctx, parentId: parent?.id, orchestratorName: parent?.name, timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs, maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries });
	recordNode(args, "debate", synthesis);
	const nodes = [...generation, ...critiques, synthesis];
	return okText(synthesis.output, { team: args.team.id, ok: nodes.every((node) => node.ok), nodes: nodeDetails(nodes) });
}

async function runResearch(args: TeamHandlerRunArgs): Promise<TeamHandlerResult> {
	const settings = resolveTeamSettings();
	const explorerModel = args.params.models?.members?.[0] ?? args.team.models.members?.[0] ?? settings.defaultMembers[0];
	const explicitVerifier = args.params.models?.members?.[1] ?? args.team.models.members?.[1] ?? args.team.models.synthesis ?? settings.defaultMembers[1];
	const verifierModel = explicitVerifier ?? explorerModel;
	const explicitSynthesis = args.params.models?.synthesis ?? args.team.models.synthesis ?? settings.defaultSynthesis;
	const synthesisModel = explicitSynthesis ?? explorerModel;
	if (!explicitVerifier && verifierModel) recordDetail(args, { kind: "fallback", phaseId: "research_loop_1", nodeId: "verifier_1", message: "research verifier model fell back to explorer model", data: { model: verifierModel } });
	if (!explicitSynthesis && synthesisModel) recordDetail(args, { kind: "fallback", phaseId: "research_synthesis", nodeId: "synthesis", message: "research synthesis model fell back to explorer model", data: { model: synthesisModel } });
	if (!explorerModel || !verifierModel || !synthesisModel) throw new Error("research teams need explorer, verifier, and synthesis models.");
	const maxLoops = boundedLoopCount(args.params.limits?.maxLoops ?? args.team.limits.maxLoops);
	const chains = promptChains(args.team, councilSlots(args.team));
	const parent = await currentPanopticonRecord(args.ctx.cwd);
	const explorerSource = bindingForRole(args.team.agentBindings, ["explorer", "member"]) ?? requireBinding(args.team, ["explorer", "member"]);
	const verifierSource = bindingForRole(args.team.agentBindings, ["verifier", "critic"]) ?? requireBinding(args.team, ["verifier", "critic"]);
	const synthesisSource = bindingForRole(args.team.agentBindings, ["synthesis"]) ?? requireBinding(args.team, ["synthesis"]);
	const handoffTargets: TeamHandoffTargetCandidate[] = Array.from({ length: Math.max(0, maxLoops - 1) }, (_value, index) => ({
		nodeId: `explorer_${index + 2}`,
		binding: { ...explorerSource, role: `explorer_${index + 2}`, label: explorerSource.label ?? `Explorer ${index + 2}` },
		model: explorerModel,
	}));
	const handoffRouter = new TeamHandoffRouter(handoffTargets);
	const nodes: NodeRun[] = [];
	let nextPrompt = `Original research request:\n${args.params.prompt}\n\nPlan and execute the first evidence-gathering pass. Emit a compact checklist, candidate claims, and explicit source bindings. Treat generated summaries as leads only.`;
	let verifierOutput = "";
	for (let loop = 1; loop <= maxLoops; loop++) {
		if (stopRequested(args)) return stoppedResult(args, nodes);
		const phaseId = `research_loop_${loop}`;
		recordPhase(args, phaseId, `Research loop ${loop}/${maxLoops}`);
		args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: explorer ${loop}/${maxLoops}`);
		const explorer = await runTeamNode({
			binding: { ...explorerSource, role: `explorer_${loop}`, label: explorerSource.label ?? `Explorer ${loop}` },
			role: `explorer_${loop}`,
			model: explorerModel,
			prompt: nextPrompt,
			systemPrompt: chainText(chains, "generation.system"),
			ctx: args.ctx,
			signal: args.signal,
			parentId: parent?.id,
			orchestratorName: parent?.name,
			timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs,
			maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries,
		});
		recordNode(args, phaseId, explorer);
		nodes.push(explorer);
		if (!explorer.ok) return okText(explorer.output, { team: args.team.id, ok: false, maxLoops, completedLoops: loop, nodes: nodeDetails(nodes) });
		if (stopRequested(args)) return stoppedResult(args, nodes);
		args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: verifier ${loop}/${maxLoops}`);
		const verifierPrompt = `Original research request:\n${args.params.prompt}\n\nExplorer output:\n${explorer.output}\n\nAct as Evidence Auditor and Gap Detector. Reject unsupported claims, require source bindings, and emit targeted follow-up queries for remaining critical gaps. If no critical gaps remain, include the exact marker VERIFIED_COMPLETE and list the verified facts only.`;
		const verifier = await runTeamNode({
			binding: { ...verifierSource, role: `verifier_${loop}`, label: verifierSource.label ?? `Verifier ${loop}` },
			role: `verifier_${loop}`,
			model: verifierModel,
			prompt: verifierPrompt,
			systemPrompt: chainText(chains, "critique.system"),
			ctx: args.ctx,
			signal: args.signal,
			parentId: parent?.id,
			orchestratorName: parent?.name,
			timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs,
			maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries,
		});
		recordNode(args, phaseId, verifier);
		nodes.push(verifier);
		verifierOutput = verifier.output;
		if (!verifier.ok) return okText(verifier.output, { team: args.team.id, ok: false, maxLoops, completedLoops: loop, nodes: nodeDetails(nodes) });
		if (stopRequested(args)) return stoppedResult(args, nodes);
		if (verifier.output.includes("VERIFIED_COMPLETE")) {
			recordDetail(args, { kind: "trace", phaseId, nodeId: `verifier_${loop}`, message: "research verifier marked evidence complete", data: { loop } });
			break;
		}
		if (loop < maxLoops) {
			recordHandoff(args, handoffRouter, {
				phaseId,
				fromNodeId: `verifier_${loop}`,
				target: { type: "node", nodeId: `explorer_${loop + 1}` },
				message: "research verifier gaps handed to next explorer pass",
				data: { loop },
			});
			nextPrompt = `Original research request:\n${args.params.prompt}\n\nPrevious Explorer output:\n${explorer.output}\n\nVerifier gap report:\n${verifier.output}\n\nRun targeted follow-up only for the cited gaps. Preserve existing verified evidence and add new source bindings.`;
		}
	}
	if (stopRequested(args)) return stoppedResult(args, nodes);
	recordPhase(args, "research_synthesis", "Research synthesis");
	args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: synthesis`);
	const synthesisPrompt = `Original research request:\n${args.params.prompt}\n\nVerifier-approved facts and caveats:\n${verifierOutput}\n\nWrite the final answer from verified facts only. Separate verified facts, inferences, recommendations, risks, and open questions. Include citations/source IDs for substantive claims and disclose unresolved gaps.`;
	const synthesis = await runTeamNode({
		binding: { ...synthesisSource, role: "synthesis", label: synthesisSource.label ?? "Synthesis" },
		role: "synthesis",
		model: synthesisModel,
		prompt: synthesisPrompt,
		systemPrompt: chainText(chains, "synthesis.system"),
		ctx: args.ctx,
		signal: args.signal,
		parentId: parent?.id,
		orchestratorName: parent?.name,
		timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs,
		maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries,
	});
	recordNode(args, "research_synthesis", synthesis);
	nodes.push(synthesis);
	return okText(synthesis.output, { team: args.team.id, ok: nodes.every((node) => node.ok), maxLoops, nodes: nodeDetails(nodes) });
}

const researchHandler: TeamHandler = {
	key: "research",
	matches(team) {
		return team.protocol === "research";
	},
	modelSlots(_team, models) {
		return [
			{ id: "explorer", label: "Explorer model", current: models.members?.[0], kind: "member", index: 0 },
			{ id: "verifier", label: "Verifier model", current: models.members?.[1] ?? models.synthesis, kind: "member", index: 1 },
			{ id: "synthesis", label: "Synthesis model", current: models.synthesis, kind: "synthesis" },
		];
	},
	async run(args) {
		return runResearch(args);
	},
};

const TEAM_HANDLERS: readonly TeamHandler[] = [
	councilHandler,
	researchHandler,
];

export function getTeamHandler(team: TeamSpec): TeamHandler | undefined {
	return TEAM_HANDLERS.find((handler) => handler.matches(team));
}

export function modelSlotsForTeam(team: TeamSpec, models: TeamModels): TeamModelSlot[] {
	const manifestSlots = manifestModelSlots(team, models);
	if (manifestSlots) return manifestSlots;
	const handler = getTeamHandler(team);
	if (!handler) return [];
	return handler.modelSlots(team, models);
}

export function promptChainsForTeam(team: TeamSpec): ResolvedPromptChain[] {
	const handler = getTeamHandler(team);
	if (!handler) return [];
	return promptChains(team, councilSlots(team));
}
