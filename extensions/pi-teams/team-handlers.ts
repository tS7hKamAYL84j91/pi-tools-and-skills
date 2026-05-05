/**
 * Protocol-specific team execution handlers and model slot metadata.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadTeamContext } from "./context-loader.js";
import { isLiveAgentRef, liveAgentModel } from "./live-agent.js";
import { formatProtocolContext, renderJoinedSynthesisPrompt, renderPeerCritiquePrompt } from "./protocol-prompts.js";
import { renderTemplate } from "./prompt-renderer.js";
import { resolveSystemPrompt, resolveTemplatePrompt, type PromptCatalog, type ResolvedPromptChain } from "./prompt-resolver.js";
import { currentPanopticonRecord } from "./runner.js";
import { resolveTeamSettings } from "./settings.js";
import type { TeamStateManager } from "./state.js";
import { bindingForRole, roleBindings } from "./team-bindings.js";
import { modelForBinding, nodeDetails, type NodeRun, participantsFromRuns, runTeamNode } from "./team-node-runner.js";
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

function pairCodingSlots(): PromptSlot[] {
	return [
		{ id: "navigatorBrief.system", kind: "system", defaultPromptId: "pair-coding/navigator-brief/system", roles: ["navigator_brief"] },
		{ id: "driverImplementation.system", kind: "system", defaultPromptId: "pair-coding/driver-implementation/system", roles: ["driver_implementation"] },
		{ id: "navigatorReview.system", kind: "system", defaultPromptId: "pair-coding/navigator-review/system", roles: ["navigator_review"] },
		{ id: "driverFix.system", kind: "system", defaultPromptId: "pair-coding/driver-fix/system", roles: ["driver_fix"] },
		{ id: "navigatorBrief.template", kind: "template", defaultPromptId: "pair-coding/navigator-brief/template", roles: ["navigator_brief"] },
		{ id: "driverImplementation.template", kind: "template", defaultPromptId: "pair-coding/driver-implementation/template", roles: ["driver_implementation"] },
		{ id: "navigatorReview.template", kind: "template", defaultPromptId: "pair-coding/navigator-review/template", roles: ["navigator_review"] },
		{ id: "driverFix.template", kind: "template", defaultPromptId: "pair-coding/driver-fix/template", roles: ["driver_fix"] },
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

function changesRequested(review: string): boolean {
	const normalized = review.toLowerCase();
	const approval = /\b(approved|looks correct|is correct|no changes|no fixes|lgtm)\b/.test(normalized);
	const defect = /\b(change|fix|defect|issue|bug|missing|required|should|must)\b/.test(normalized);
	return defect || !approval;
}

const pairCodingHandler: TeamHandler = {
	key: "pair-coding",
	matches(team) {
		return team.protocol === "pair-coding";
	},
	modelSlots(_team, models) {
		return [
			{ id: "driver", label: "Driver model", current: models.driver, kind: "driver" },
			{ id: "navigator", label: "Navigator model", current: models.navigator, kind: "navigator" },
		];
	},
	async run(args) {
		const settings = resolveTeamSettings();
		const navBrief = requireBinding(args.team, ["navigator_brief", "navigator"]);
		const driverImpl = requireBinding(args.team, ["driver_implementation", "driver"]);
		const navReview = bindingForRole(args.team.agentBindings, ["navigator_review", "navigator"]) ?? navBrief;
		const driverFix = bindingForRole(args.team.agentBindings, ["driver_fix", "driver"]) ?? driverImpl;
		const driver = args.params.models?.driver ?? modelForBinding(driverImpl, args.team.models.driver ?? settings.defaultMembers[0]);
		const navigator = args.params.models?.navigator ?? modelForBinding(navBrief, args.team.models.navigator ?? settings.defaultSynthesis);
		if (!driver || !navigator) throw new Error("pair-coding needs driver and navigator models.");
		const context = formatProtocolContext(loadTeamContext({ cwd: args.ctx.cwd, specPath: args.params.specPath, files: args.params.files }));
		const chains = promptChains(args.team, pairCodingSlots());
		const parent = await currentPanopticonRecord(args.ctx.cwd);
		const timeoutMs = args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs;
		const maxRetries = args.params.limits?.maxRetries ?? args.team.limits.maxRetries;
		const nodes: NodeRun[] = [];
		recordPhase(args, "pair-coding");
		const brief = await runTeamNode({ binding: { ...navBrief, role: "navigator_brief" }, role: "navigator_brief", model: navigator, prompt: renderTemplate(chainText(chains, "navigatorBrief.template").split("\n"), { context, prompt: args.params.prompt }), systemPrompt: chainText(chains, "navigatorBrief.system"), ctx: args.ctx, parentId: parent?.id, orchestratorName: parent?.name, timeoutMs, maxRetries });
		nodes.push(brief);
		recordNode(args, "pair-coding", brief);
		let artifact = (await runTeamNode({ binding: { ...driverImpl, role: "driver_implementation" }, role: "driver_implementation", model: driver, prompt: renderTemplate(chainText(chains, "driverImplementation.template").split("\n"), { context, prompt: args.params.prompt, navigatorBrief: brief.output }), systemPrompt: chainText(chains, "driverImplementation.system"), ctx: args.ctx, parentId: parent?.id, orchestratorName: parent?.name, timeoutMs, maxRetries }));
		nodes.push(artifact);
		recordNode(args, "pair-coding", artifact);
		const maxFixPasses = Math.max(0, args.params.limits?.maxFixPasses ?? args.team.limits.maxFixPasses ?? 1);
		for (let pass = 1; pass <= maxFixPasses; pass++) {
			const review = await runTeamNode({ binding: { ...navReview, role: `navigator_review_${pass}` }, role: `navigator_review_${pass}`, model: navigator, prompt: renderTemplate(chainText(chains, "navigatorReview.template").split("\n"), { context, prompt: args.params.prompt, driverArtifact: artifact.output }), systemPrompt: chainText(chains, "navigatorReview.system"), ctx: args.ctx, parentId: parent?.id, orchestratorName: parent?.name, timeoutMs, maxRetries });
			nodes.push(review);
			recordNode(args, "pair-coding", review);
			if (!review.ok || !changesRequested(review.output)) break;
			artifact = await runTeamNode({ binding: { ...driverFix, role: `driver_fix_${pass}` }, role: `driver_fix_${pass}`, model: driver, prompt: renderTemplate(chainText(chains, "driverFix.template").split("\n"), { prompt: args.params.prompt, driverArtifact: artifact.output, navigatorReview: review.output }), systemPrompt: chainText(chains, "driverFix.system"), ctx: args.ctx, parentId: parent?.id, orchestratorName: parent?.name, timeoutMs, maxRetries });
			nodes.push(artifact);
			recordNode(args, "pair-coding", artifact);
		}
		return okText(artifact.output, { team: args.team.id, ok: nodes.every((node) => node.ok), nodes: nodeDetails(nodes) });
	},
};

const TEAM_HANDLERS: readonly TeamHandler[] = [
	councilHandler,
	pairCodingHandler,
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
	if (handler.key === "pair-coding") return promptChains(team, pairCodingSlots());
	return promptChains(team, councilSlots(team));
}
