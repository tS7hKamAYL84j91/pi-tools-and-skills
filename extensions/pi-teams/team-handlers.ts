/**
 * Protocol-specific team execution handlers and model slot metadata.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
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

async function runDebate(args: TeamHandlerRunArgs): Promise<TeamHandlerResult> {
	const settings = resolveTeamSettings();
	const memberModels = args.params.models?.members ?? args.team.models.members ?? settings.defaultMembers;
	if (memberModels.length === 0) throw new Error("debate teams need at least one member model.");
	const synthesisModel = args.params.models?.synthesis ?? args.team.models.synthesis ?? settings.defaultSynthesis ?? memberModels[0];
	if (!synthesisModel) throw new Error("debate teams need a synthesis model.");
	const chains = promptChains(args.team, councilSlots(args.team));
	const parent = await currentPanopticonRecord(args.ctx.cwd);
	const sourceMembers = roleBindings(args.team.agentBindings, ["member"]);
	const memberSource = sourceMembers[0] ?? requireBinding(args.team, ["member"]);
	const criticSource = bindingForRole(args.team.agentBindings, ["critic"]) ?? memberSource;
	const synthesisSource = bindingForRole(args.team.agentBindings, ["synthesis"]) ?? requireBinding(args.team, ["synthesis"]);
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
	const synthesisPrompt = renderJoinedSynthesisPrompt({ originalPrompt: args.params.prompt, generation: okGeneration, critiques: participantsFromRuns(critiques.filter((node) => node.ok)), members, template: chainText(chains, "synthesis.template").split("\n") });
	const synthesis = await runTeamNode({ binding: { ...synthesisSource, role: "synthesis", label: synthesisSource.label ?? "Synthesis" }, role: "synthesis", model: synthesisModel, prompt: synthesisPrompt, systemPrompt: chainText(chains, "synthesis.system"), ctx: args.ctx, parentId: parent?.id, orchestratorName: parent?.name, timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs, maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries });
	recordNode(args, "debate", synthesis);
	const nodes = [...generation, ...critiques, synthesis];
	return okText(synthesis.output, { team: args.team.id, ok: nodes.every((node) => node.ok), nodes: nodeDetails(nodes) });
}

const TEAM_HANDLERS: readonly TeamHandler[] = [
	councilHandler,
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
