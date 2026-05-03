/**
 * Graph lowering for bundled team protocols.
 */

import { loadTeamContext } from "./context-loader.js";
import { requirePromptChain, resolveProtocolPromptChains } from "./protocol-contracts.js";
import { formatProtocolContext, renderJoinedSynthesisPrompt, renderPeerCritiquePrompt } from "./protocol-prompts.js";
import { renderTemplate } from "./prompt-renderer.js";
import { resolveTeamSettings, type ResolvedTeamSettings } from "./settings.js";
import { bindingForRole, roleBindings } from "./team-bindings.js";
import type { GraphNodePromptBuilder, GraphRunResult } from "./team-graph.js";
import type { TeamAgentBinding, TeamSpec } from "./team-types.js";
import type { ModelRun, TeamParticipant } from "./types.js";

interface TeamRunModels {
	members?: string[];
	synthesis?: string;
	driver?: string;
	navigator?: string;
}

interface TeamRunLimits {
	maxFixPasses?: number;
}

interface GraphPlanRunInput {
	id?: string;
	prompt: string;
	files?: string[];
	specPath?: string;
	models?: TeamRunModels;
	limits?: TeamRunLimits;
}

interface GraphPlanArgs {
	team: TeamSpec;
	params: GraphPlanRunInput;
	settings: ResolvedTeamSettings;
	cwd?: string;
}

interface LoweredGraphPlan {
	team: TeamSpec;
	phaseId: string;
	outputRole: string;
	templateSlot?: string;
	buildNodePrompt?: GraphNodePromptBuilder;
}

function rejectAgentRef(role: "driver" | "navigator", value: string): string | undefined {
	if (value.toLowerCase().startsWith("agent:")) {
		return `pair-coding ${role} must be a model id, not an agent ref ("${value}").`;
	}
	return undefined;
}

function promptChainsForTeam(team: TeamSpec) {
	const catalog = resolveTeamSettings().prompts;
	return resolveProtocolPromptChains({ protocol: team.protocol, prompts: team.prompts, bindings: team.agentBindings }, catalog);
}

function firstBinding(team: TeamSpec, roles: string[]): TeamAgentBinding {
	const binding = bindingForRole(team.agentBindings, roles) ?? team.agentBindings[0];
	if (!binding) throw new Error(`Team "${team.id}" needs at least one role binding.`);
	return binding;
}

function debateParticipants(bindings: readonly TeamAgentBinding[]): TeamParticipant[] {
	return bindings.map((binding) => ({ label: binding.label ?? binding.role, model: binding.model ?? "" }));
}

function cloneBinding(source: TeamAgentBinding, role: string, model: string, systemPrompt: string): TeamAgentBinding {
	return { ...source, role, model, systemPrompt };
}

function graphPlanForDebate(args: GraphPlanArgs): LoweredGraphPlan {
	const chains = promptChainsForTeam(args.team);
	const memberModelIds = args.params.models?.members ?? args.team.models.members ?? args.settings.defaultMembers;
	if (memberModelIds.length === 0) throw new Error("debate teams need at least one member model.");
	const synthesisId = args.params.models?.synthesis ?? args.team.models.synthesis ?? args.settings.defaultSynthesis ?? memberModelIds[0];
	if (!synthesisId) throw new Error("debate teams need a synthesis model.");
	const sourceMembers = roleBindings(args.team.agentBindings, ["member"]);
	const memberSource = sourceMembers[0] ?? firstBinding(args.team, ["member"]);
	const criticSource = bindingForRole(args.team.agentBindings, ["critic"]) ?? memberSource;
	const synthesisSource = bindingForRole(args.team.agentBindings, ["synthesis"]) ?? firstBinding(args.team, ["synthesis"]);
	const generationBindings = memberModelIds.map((model, index) => {
		const source = sourceMembers[index] ?? memberSource;
		return { ...source, role: `generation_${index + 1}`, label: source.label ?? `Member ${index + 1}`, model, systemPrompt: requirePromptChain(chains, "generation.system").text };
	});
	const critiqueBindings = memberModelIds.map((model, index) => ({
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
		model: synthesisId,
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
			models: { members: memberModelIds, synthesis: synthesisId },
		},
		phaseId: "debate",
		outputRole: synthesisBinding.role,
		buildNodePrompt: debatePromptBuilder(args.team, generationBindings, critiqueBindings),
	};
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
	const reviewSource = bindingForRole(args.team.agentBindings, ["navigator_review", "navigator"]) ?? navBriefSource;
	const fixSource = bindingForRole(args.team.agentBindings, ["driver_fix", "driver"]) ?? driverSource;
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
