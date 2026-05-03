/**
 * Protocol-specific team execution handlers and model slot metadata.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadTeamContext } from "./context-loader.js";
import { formatProtocolContext, renderJoinedSynthesisPrompt, renderPeerCritiquePrompt } from "./protocol-prompts.js";
import { requirePromptChain, resolveProtocolPromptChains } from "./protocol-contracts.js";
import { renderTemplate } from "./prompt-renderer.js";
import { resolveTeamSettings, type ResolvedTeamSettings } from "./settings.js";
import type { TeamStateManager } from "./state.js";
import { type GraphNodePromptBuilder, type GraphRunResult, runTeamGraph } from "./team-graph.js";
import type { TeamAgentBinding, TeamModels, TeamSpec } from "./team-types.js";
import type { ModelRun, TeamParticipant } from "./types.js";

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
}

export interface TeamRunInput {
	id: string;
	prompt: string;
	files?: string[];
	specPath?: string;
	models?: TeamRunModels;
	limits?: TeamRunLimits;
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

function okText(text: string, details: Record<string, unknown>): TeamHandlerResult {
	return { content: [{ type: "text", text }], details };
}

function rejectAgentRef(role: "driver" | "navigator", value: string): string | undefined {
	if (value.toLowerCase().startsWith("agent:")) {
		return `pair-coding ${role} must be a model id, not an agent ref ("${value}").`;
	}
	return undefined;
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

function bindingForRole(team: TeamSpec, roles: string[]): TeamAgentBinding | undefined {
	return team.agentBindings.find((binding) => {
		const normalized = binding.role.toLowerCase().replaceAll("-", "_");
		return roles.some((role) => normalized === role || normalized.startsWith(`${role}_`));
	});
}

function recordPhase(args: TeamHandlerRunArgs, phaseId: string, label = phaseId): void {
	if (args.runId) args.stateManager.recordPhaseStarted(args.runId, phaseId, label);
}

interface LoweredGraphPlan {
	team: TeamSpec;
	phaseId: string;
	outputRole: string;
	templateSlot?: string;
	buildNodePrompt?: GraphNodePromptBuilder;
}

interface GraphPlanArgs {
	team: TeamSpec;
	params: TeamRunInput;
	settings: ResolvedTeamSettings;
	cwd?: string;
}

function promptChainsForTeam(team: TeamSpec) {
	const catalog = resolveTeamSettings().prompts;
	return resolveProtocolPromptChains({ protocol: team.protocol, prompts: team.prompts, bindings: team.agentBindings }, catalog);
}

function firstBinding(team: TeamSpec, roles: string[]): TeamAgentBinding {
	const binding = bindingForRole(team, roles) ?? team.agentBindings[0];
	if (!binding) throw new Error(`Team "${team.id}" needs at least one role binding.`);
	return binding;
}

function roleBindings(team: TeamSpec, roles: string[]): TeamAgentBinding[] {
	return team.agentBindings.filter((binding) => bindingForRole({ ...team, agentBindings: [binding] }, roles));
}

function debateParticipants(bindings: readonly TeamAgentBinding[]): TeamParticipant[] {
	return bindings.map((binding) => ({ label: binding.label ?? binding.role, model: binding.model ?? "" }));
}

function graphPlanForDebate(args: GraphPlanArgs): LoweredGraphPlan {
	const chains = promptChainsForTeam(args.team);
	const memberModels = args.params.models?.members ?? args.team.models.members ?? args.settings.defaultMembers;
	if (memberModels.length === 0) throw new Error("debate teams need at least one member model.");
	const synthesisModel = args.params.models?.synthesis ?? args.team.models.synthesis ?? args.settings.defaultSynthesis ?? memberModels[0];
	if (!synthesisModel) throw new Error("debate teams need a synthesis model.");
	const sourceMembers = roleBindings(args.team, ["member"]);
	const memberSource = sourceMembers[0] ?? firstBinding(args.team, ["member"]);
	const criticSource = bindingForRole(args.team, ["critic"]) ?? memberSource;
	const synthesisSource = bindingForRole(args.team, ["synthesis"]) ?? firstBinding(args.team, ["synthesis"]);
	const generationBindings = memberModels.map((model, index) => {
		const source = sourceMembers[index] ?? memberSource;
		return { ...source, role: `generation_${index + 1}`, label: source.label ?? `Member ${index + 1}`, model, systemPrompt: requirePromptChain(chains, "generation.system").text };
	});
	const critiqueBindings = memberModels.map((model, index) => ({
		...criticSource,
		role: `critique_${index + 1}`,
		label: generationBindings[index]?.label ?? `Member ${index + 1}`,
		model,
		systemPrompt: requirePromptChain(chains, "critique.system").text,
		dependencyPolicy: "allow-failed" as const,
	}));
	const synthesisBinding = {
		...synthesisSource,
		role: "synthesis",
		label: synthesisSource.label ?? "Synthesis",
		model: synthesisModel,
		systemPrompt: requirePromptChain(chains, "synthesis.system").text,
		dependencyPolicy: "allow-failed" as const,
	};
	const generationEdges = generationBindings.flatMap((from) => critiqueBindings.map((to) => ({ from: from.role, to: to.role })));
	const synthesisEdges = [...generationBindings, ...critiqueBindings].map((from) => ({ from: from.role, to: synthesisBinding.role }));
	return {
		team: {
			...args.team,
			agents: [...new Set([...generationBindings, ...critiqueBindings, synthesisBinding].map((binding) => binding.subagent))],
			agentBindings: [...generationBindings, ...critiqueBindings, synthesisBinding],
			graph: { edges: [...generationEdges, ...synthesisEdges], outputs: [synthesisBinding.role] },
			models: { members: memberModels, synthesis: synthesisModel },
		},
		phaseId: "debate",
		outputRole: synthesisBinding.role,
		buildNodePrompt: debatePromptBuilder(args.team, generationBindings, critiqueBindings),
	};
}

function cloneBinding(source: TeamAgentBinding, role: string, model: string, systemPrompt: string): TeamAgentBinding {
	return { ...source, role, model, systemPrompt };
}

function graphPlanForPairCoding(args: GraphPlanArgs): LoweredGraphPlan {
	const chains = promptChainsForTeam(args.team);
	const driver = args.params.models?.driver ?? args.team.models.driver ?? args.settings.defaultMembers[0];
	const navigator = args.params.models?.navigator ?? args.team.models.navigator ?? args.settings.defaultSynthesis;
	if (!driver || !navigator) throw new Error("pair-coding needs driver and navigator models.");
	const driverError = rejectAgentRef("driver", driver);
	if (driverError) throw new Error(driverError);
	const navigatorError = rejectAgentRef("navigator", navigator);
	if (navigatorError) throw new Error(navigatorError);
	const navBriefSource = firstBinding(args.team, ["navigator_brief", "navigator"]);
	const driverSource = firstBinding(args.team, ["driver_implementation", "driver"]);
	const reviewSource = bindingForRole(args.team, ["navigator_review", "navigator"]) ?? navBriefSource;
	const fixSource = bindingForRole(args.team, ["driver_fix", "driver"]) ?? driverSource;
	const maxFixPasses = Math.max(0, args.params.limits?.maxFixPasses ?? args.team.limits.maxFixPasses ?? 1);
	const context = loadTeamContext({ cwd: args.cwd ?? process.cwd(), specPath: args.params.specPath, files: args.params.files });
	const nodes: TeamAgentBinding[] = [
		cloneBinding(navBriefSource, "navigator_brief", navigator, requirePromptChain(chains, "navigatorBrief.system").text),
		cloneBinding(driverSource, "driver_implementation", driver, requirePromptChain(chains, "driverImplementation.system").text),
	];
	for (let pass = 1; pass <= maxFixPasses; pass++) {
		nodes.push(
			cloneBinding(reviewSource, `navigator_review_${pass}`, navigator, requirePromptChain(chains, "navigatorReview.system").text),
			cloneBinding(fixSource, `driver_fix_${pass}`, driver, requirePromptChain(chains, "driverFix.system").text),
		);
	}
	const edges = nodes.slice(1).map((node, index) => ({ from: nodes[index]?.role ?? "", to: node.role }));
	return {
		team: {
			...args.team,
			agents: [...new Set(nodes.map((binding) => binding.subagent))],
			agentBindings: nodes,
			graph: { edges, outputs: [nodes[nodes.length - 1]?.role ?? "driver_implementation"] },
			models: { driver, navigator },
		},
		phaseId: "pair-coding",
		outputRole: nodes[nodes.length - 1]?.role ?? "driver_implementation",
		buildNodePrompt: pairCodingPromptBuilder(args.team, formatProtocolContext(context)),
	};
}

function graphPlanForConsult(args: GraphPlanArgs): LoweredGraphPlan {
	const navigator = args.params.models?.navigator ?? args.team.models.navigator ?? args.settings.defaultConsult?.navigator;
	if (!navigator) throw new Error("consult teams need a navigator model.");
	if (navigator.toLowerCase().startsWith("agent:")) {
		throw new Error(`consult graph nodes require model ids; live-agent ref "${navigator}" is unsupported.`);
	}
	const chains = promptChainsForTeam(args.team);
	const binding = {
		...firstBinding(args.team, ["navigator"]),
		role: "navigator",
		model: navigator,
		systemPrompt: requirePromptChain(chains, "navigator.system").text,
	};
	return {
		team: {
			...args.team,
			agents: [binding.subagent],
			agentBindings: [binding],
			graph: { edges: [], outputs: ["navigator"] },
			models: { members: [navigator], navigator },
		},
		phaseId: "consult",
		outputRole: "navigator",
	};
}

function graphPlanForTelephone(args: GraphPlanArgs): LoweredGraphPlan {
	const models = args.params.models?.members ?? args.team.models.members ?? args.settings.defaultMembers;
	const fallbackModel = models[0];
	if (!fallbackModel) throw new Error("telephone teams need at least one member model.");
	const bindings = args.team.agentBindings.map((binding, index) => ({
		...binding,
		model: models[index] ?? fallbackModel,
	}));
	const edges = bindings.slice(1).map((binding, index) => ({ from: bindings[index]?.role ?? "", to: binding.role }));
	return {
		team: {
			...args.team,
			agentBindings: bindings,
			graph: { edges, outputs: [bindings[bindings.length - 1]?.role ?? ""] },
			models: { members: bindings.map((binding) => binding.model as string) },
		},
		phaseId: "telephone",
		outputRole: bindings[bindings.length - 1]?.role ?? "",
		templateSlot: "relay.template",
		buildNodePrompt: telephonePromptBuilder(args.team),
	};
}

export function graphPlanForSimpleProtocol(args: GraphPlanArgs): LoweredGraphPlan | undefined {
	if (args.team.protocol === "debate") return graphPlanForDebate(args);
	if (args.team.protocol === "pair-coding") return graphPlanForPairCoding(args);
	if (args.team.protocol === "consult") return graphPlanForConsult(args);
	if (args.team.protocol === "telephone") return graphPlanForTelephone(args);
	return undefined;
}

function modelRunFromNode(node: GraphRunResult["nodes"][number]): ModelRun {
	return {
		member: { label: node.binding.label ?? node.role, model: node.model ?? "" },
		prompt: "",
		systemPrompt: "",
		output: node.output,
		durationMs: node.durationMs ?? 0,
		ok: node.ok,
		...(node.error ? { error: node.error } : {}),
	};
}

function debatePromptBuilder(
	team: TeamSpec,
	generationBindings: readonly TeamAgentBinding[],
	critiqueBindings: readonly TeamAgentBinding[],
): GraphNodePromptBuilder {
	const chains = promptChainsForTeam(team);
	const generationRoles = new Set(generationBindings.map((binding) => binding.role));
	const critiqueRoles = new Set(critiqueBindings.map((binding) => binding.role));
	const members = debateParticipants(generationBindings);
	return (args) => {
		if (generationRoles.has(args.binding.role)) return { prompt: args.originalPrompt, systemPrompt: args.binding.systemPrompt ?? "" };
		const generation = args.completed.filter((node) => generationRoles.has(node.role) && node.ok).map(modelRunFromNode);
		if (critiqueRoles.has(args.binding.role)) {
			return {
				prompt: renderPeerCritiquePrompt({
					originalPrompt: args.originalPrompt,
					generation,
					members,
					viewer: { label: args.binding.label ?? args.binding.role, model: args.model },
					template: requirePromptChain(chains, "critique.template").text.split("\n"),
				}),
				systemPrompt: args.binding.systemPrompt ?? "",
			};
		}
		const critiques = args.completed.filter((node) => critiqueRoles.has(node.role) && node.ok).map(modelRunFromNode);
		return {
			prompt: renderJoinedSynthesisPrompt({
				originalPrompt: args.originalPrompt,
				generation,
				critiques,
				members,
				template: requirePromptChain(chains, "synthesis.template").text.split("\n"),
			}),
			systemPrompt: args.binding.systemPrompt ?? "",
		};
	};
}

function priorOutput(args: Parameters<GraphNodePromptBuilder>[0], role: string): string {
	return args.completed.find((node) => node.role === role)?.output ?? "";
}

function pairCodingPromptBuilder(team: TeamSpec, context: string): GraphNodePromptBuilder {
	const chains = promptChainsForTeam(team);
	return (args) => {
		if (args.binding.role === "navigator_brief") {
			return {
				prompt: renderTemplate(requirePromptChain(chains, "navigatorBrief.template").text.split("\n"), { context, prompt: args.originalPrompt }),
				systemPrompt: args.binding.systemPrompt ?? "",
			};
		}
		if (args.binding.role === "driver_implementation") {
			return {
				prompt: renderTemplate(requirePromptChain(chains, "driverImplementation.template").text.split("\n"), {
					context,
					prompt: args.originalPrompt,
					navigatorBrief: priorOutput(args, "navigator_brief"),
				}),
				systemPrompt: args.binding.systemPrompt ?? "",
			};
		}
		const reviewMatch = /^navigator_review_(\d+)$/.exec(args.binding.role);
		if (reviewMatch?.[1]) {
			const pass = Number(reviewMatch[1]);
			const artifact = pass === 1 ? priorOutput(args, "driver_implementation") : priorOutput(args, `driver_fix_${pass - 1}`);
			return {
				prompt: renderTemplate(requirePromptChain(chains, "navigatorReview.template").text.split("\n"), {
					context,
					prompt: args.originalPrompt,
					driverArtifact: artifact,
				}),
				systemPrompt: args.binding.systemPrompt ?? "",
			};
		}
		const fixMatch = /^driver_fix_(\d+)$/.exec(args.binding.role);
		if (fixMatch?.[1]) {
			const pass = Number(fixMatch[1]);
			const artifact = pass === 1 ? priorOutput(args, "driver_implementation") : priorOutput(args, `driver_fix_${pass - 1}`);
			return {
				prompt: renderTemplate(requirePromptChain(chains, "driverFix.template").text.split("\n"), {
					prompt: args.originalPrompt,
					driverArtifact: artifact,
					navigatorReview: priorOutput(args, `navigator_review_${pass}`),
				}),
				systemPrompt: args.binding.systemPrompt ?? "",
			};
		}
		return { prompt: args.originalPrompt, systemPrompt: args.binding.systemPrompt ?? "" };
	};
}

function telephonePromptBuilder(team: TeamSpec): GraphNodePromptBuilder {
	const chains = promptChainsForTeam(team);
	const relaySystemTemplate = requirePromptChain(chains, "relay.system").text;
	const roleOrder = new Map(team.agentBindings.map((binding, index) => [binding.role, index]));
	return (args) => {
		const index = (roleOrder.get(args.binding.role) ?? 0) + 1;
		const priorMessage = args.upstream[0]?.output.trim() || args.originalPrompt;
		return {
			prompt: renderTemplate(args.defaultTemplate.split("\n"), { message: priorMessage }),
			systemPrompt: renderTemplate(relaySystemTemplate.split("\n"), {
				index: index.toString(),
				total: team.agentBindings.length.toString(),
			}),
		};
	};
}

function graphResultText(result: GraphRunResult, outputRole: string): string {
	return result.nodes.find((node) => node.role === outputRole)?.output || result.output;
}

function graphNodeDetails(result: GraphRunResult): Array<Record<string, unknown>> {
	return result.nodes.map((node) => ({
		role: node.binding.role,
		model: node.model,
		ok: node.ok,
		status: node.status,
		durationMs: node.durationMs,
	}));
}

const graphHandler: TeamHandler = {
	key: "graph",
	matches(team) {
		return (team.graph?.edges.length ?? 0) > 0 || team.protocol === "graph";
	},
	modelSlots(team, models) {
		return memberModelSlots({
			count: Math.max(team.agentBindings.length, models.members?.length ?? 0, 1),
			label: (index) => team.agentBindings[index]?.role ?? `Graph node ${index + 1}`,
			models,
		});
	},
	async run(args) {
		const result = await runTeamGraph({
			team: args.team,
			prompt: args.params.prompt,
			ctx: args.ctx,
			timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs,
			onProgress: (text) => args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: ${text}`),
		});
		recordPhase(args, "graph");
		if (args.runId) {
			for (const node of result.nodes) {
				args.stateManager.recordNodeCompleted(args.runId, {
					phaseId: "graph",
					nodeId: node.role,
					role: node.binding.role,
					model: node.model ?? "",
					ok: node.ok,
					durationMs: node.durationMs ?? 0,
					output: node.output,
					...(node.error ? { error: node.error } : {}),
				});
			}
		}
		return okText(result.output, {
			team: args.team.id,
			ok: result.ok,
			nodes: result.nodes.map((node) => ({
				role: node.binding.role,
				model: node.model,
				ok: node.ok,
				status: node.status,
				durationMs: node.durationMs,
			})),
		});
	},
};

const loweredGraphHandler: TeamHandler = {
	key: "lowered-graph",
	matches(team) {
		return team.protocol === "debate" || team.protocol === "pair-coding" || team.protocol === "consult" || team.protocol === "telephone";
	},
	modelSlots(team, models) {
		if (team.protocol === "consult") {
			return [{ id: "navigator", label: "Navigator model", current: models.navigator, kind: "navigator" }];
		}
		if (team.protocol === "pair-coding") {
			return [
				{ id: "driver", label: "Driver model", current: models.driver, kind: "driver" },
				{ id: "navigator", label: "Navigator model", current: models.navigator, kind: "navigator" },
			];
		}
		if (team.protocol === "debate") {
			return [
				...memberModelSlots({
					count: Math.max(models.members?.length ?? 0, roleBindings(team, ["member"]).length, 1),
					label: (index) => `Member model ${index + 1}`,
					models,
				}),
				{ id: "synthesis", label: "Synthesis model", current: models.synthesis, kind: "synthesis" },
			];
		}
		return memberModelSlots({
			count: Math.max(models.members?.length ?? 0, team.agents.length, 1),
			label: (index) => `Relay model ${index + 1}`,
			models,
		});
	},
	async run(args) {
		const settings = resolveTeamSettings();
		const plan = graphPlanForSimpleProtocol({ team: args.team, params: args.params, settings, cwd: args.ctx.cwd });
		if (!plan) throw new Error(`Protocol ${args.team.protocol} cannot be lowered to graph execution.`);
		const result = await runTeamGraph({
			team: plan.team,
			prompt: args.params.prompt,
			ctx: args.ctx,
			timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs,
			templateSlot: plan.templateSlot,
			buildNodePrompt: plan.buildNodePrompt,
			onProgress: (text) => args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: ${text}`),
		});
		recordPhase(args, plan.phaseId);
		if (args.runId) {
			for (const node of result.nodes) {
				args.stateManager.recordNodeCompleted(args.runId, {
					phaseId: plan.phaseId,
					nodeId: node.role,
					role: node.binding.role,
					model: node.model ?? "",
					ok: node.ok,
					durationMs: node.durationMs ?? 0,
					output: node.output,
					...(node.error ? { error: node.error } : {}),
				});
			}
		}
		return okText(graphResultText(result, plan.outputRole), {
			team: args.team.id,
			ok: result.ok,
			nodes: graphNodeDetails(result),
		});
	},
};

const TEAM_HANDLERS: readonly TeamHandler[] = [
	graphHandler,
	loweredGraphHandler,
];

export function getTeamHandler(team: TeamSpec): TeamHandler | undefined {
	return TEAM_HANDLERS.find((handler) => handler.matches(team));
}

export function modelSlotsForTeam(team: TeamSpec, models: TeamModels): TeamModelSlot[] {
	const handler = getTeamHandler(team);
	if (!handler) return [];
	return handler.modelSlots(team, models);
}
