/**
 * Protocol-specific team execution handlers and model slot metadata.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { deliberate, formatFailures, preflight } from "./deliberation.js";
import { snapshotAvailableModels } from "./members.js";
import { type WorkflowResult, runPairCoding } from "./pair-coding.js";
import { requirePromptChain, resolveProtocolPromptChains } from "./protocol-contracts.js";
import { renderTemplate } from "./prompt-renderer.js";
import { resolveTeamSettings, type ResolvedTeamSettings } from "./settings.js";
import type { TeamStateManager } from "./state.js";
import { type GraphNodePromptBuilder, type GraphRunResult, runTeamGraph } from "./team-graph.js";
import { teamToDebateDefinition } from "./team-registry.js";
import type { TeamAgentBinding, TeamModels, TeamSpec } from "./team-types.js";
import type { GenerationConfig, ModelRun, TeamRunDefinition } from "./types.js";

export const TEAM_STATUS_KEY = "team";
export interface TeamRunModels {
	members?: string[];
	chairman?: string;
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
	kind: "member" | "chairman" | "driver" | "navigator";
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

function generationConfigForRole(team: TeamSpec, roles: string[]): GenerationConfig | undefined {
	const binding = bindingForRole(team, roles);
	if (binding?.tools === undefined && binding?.parameters === undefined) return undefined;
	return {
		...(binding.tools !== undefined ? { tools: binding.tools } : {}),
		...(binding.parameters !== undefined ? { parameters: binding.parameters } : {}),
	};
}

function recordPhase(args: TeamHandlerRunArgs, phaseId: string, label = phaseId): void {
	if (args.runId) args.stateManager.recordPhaseStarted(args.runId, phaseId, label);
}

function recordModelRun(args: TeamHandlerRunArgs, phaseId: string, nodeId: string, run: ModelRun): void {
	if (!args.runId) return;
	args.stateManager.recordNodeCompleted(args.runId, {
		phaseId,
		nodeId,
		role: run.member.label,
		model: run.member.model,
		ok: run.ok,
		durationMs: run.durationMs,
		output: run.output,
		...(run.error ? { error: run.error } : {}),
	});
}

function formatWorkflowResult(result: WorkflowResult): TeamHandlerResult {
	const sections: string[] = [];
	if (result.context.warnings.length > 0) {
		sections.push(
			`Context warnings:\n${result.context.warnings.map((warning) => `- ${warning}`).join("\n")}`,
		);
	}
	if (result.errors.length > 0) {
		sections.push(`Errors:\n${result.errors.map((error) => `- ${error}`).join("\n")}`);
	}
	const body = sections.length > 0
		? `${result.summary}\n\n${sections.join("\n\n")}`
		: result.summary;
	return okText(body, {
		team: "pair-coding",
		mode: result.mode,
		ok: result.ok,
		phases: result.phases,
		context: result.context,
		warnings: result.context.warnings,
	});
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
	if (args.team.protocol === "consult") return graphPlanForConsult(args);
	if (args.team.protocol === "telephone") return graphPlanForTelephone(args);
	return undefined;
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

const debateHandler: TeamHandler = {
	key: "debate",
	matches(team) {
		return team.protocol === "debate";
	},
	modelSlots(_team, models) {
		const memberCount = Math.max(models.members?.length ?? 0, 1);
		return [
			...memberModelSlots({
				count: memberCount,
				label: (index) => `Member model ${index + 1}`,
				models,
			}),
			{
				id: "chairman",
				label: "Chairman model",
				current: models.chairman,
				kind: "chairman",
			},
		];
	},
	async run(args) {
		const snapshot = snapshotAvailableModels(args.ctx);
		const chains = promptChainsForTeam(args.team);
		const base = teamToDebateDefinition({ team: args.team, snapshot });
		const definition: TeamRunDefinition = {
			...base,
			members: args.params.models?.members ?? base.members,
			chairman: args.params.models?.chairman ?? base.chairman,
		};
		const report = preflight(definition, snapshot);
		args.ctx.ui.notify(`Team "${args.team.id}" debating with ${definition.members.length} member(s)...`, "info");
		const record = await deliberate({
			definition,
			prompt: args.params.prompt,
			ctx: args.ctx,
			availableSnapshot: snapshot,
			stateManager: args.stateManager,
			prompts: {
				generationSystem: requirePromptChain(chains, "generation.system").text,
				critiqueSystem: requirePromptChain(chains, "critique.system").text,
				synthesisSystem: requirePromptChain(chains, "synthesis.system").text,
				critiqueTemplate: requirePromptChain(chains, "critique.template").text.split("\n"),
				synthesisTemplate: requirePromptChain(chains, "synthesis.template").text.split("\n"),
			},
			parallelTimeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs,
			onProgress: (text) => {
				args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: ${text}`);
			},
		});
		const failures = [...record.generation, ...record.critiques].filter((run) => !run.ok);
		const sections: string[] = [];
		if (report.warnings.length > 0) {
			sections.push(`Pre-flight warnings:\n${report.warnings.map((warning) => `- ${warning}`).join("\n")}`);
		}
		if (failures.length > 0) sections.push(`Partial failures:\n${formatFailures(failures)}`);
		const synthesis = record.synthesis?.output ?? "(no synthesis)";
		const body = sections.length > 0 ? `${synthesis}\n\n${sections.join("\n\n")}` : synthesis;
		return okText(body, {
			team: args.team.id,
			id: record.id,
			members: record.members.map((member) => member.model),
			chairman: record.chairman.model,
			warnings: report.warnings,
		});
	},
};

const pairCodingHandler: TeamHandler = {
	key: "pair-coding",
	matches(team) {
		return team.protocol === "pair-coding";
	},
	modelSlots(_team, models) {
		return [
			{
				id: "driver",
				label: "Driver model",
				current: models.driver,
				kind: "driver",
			},
			{
				id: "navigator",
				label: "Navigator model",
				current: models.navigator,
				kind: "navigator",
			},
		];
	},
	async run(args) {
		const settings = resolveTeamSettings();
		const chains = promptChainsForTeam(args.team);
		const driver = args.params.models?.driver ?? args.team.models.driver ?? settings.defaultMembers[0];
		const navigator = args.params.models?.navigator ?? args.team.models.navigator ?? settings.defaultChairman;
		if (!driver || !navigator) throw new Error("pair-coding needs driver and navigator models.");
		const driverError = rejectAgentRef("driver", driver);
		if (driverError) throw new Error(driverError);
		const navigatorError = rejectAgentRef("navigator", navigator);
		if (navigatorError) throw new Error(navigatorError);
		args.ctx.ui.notify(`Team "${args.team.id}": driver=${driver} navigator=${navigator}`, "info");
		const result = await runPairCoding({
			ctx: args.ctx,
			prompt: args.params.prompt,
			driver,
			navigator,
			driverConfig: generationConfigForRole(args.team, ["driver"]),
			navigatorConfig: generationConfigForRole(args.team, ["navigator"]),
			prompts: {
				navigatorBriefSystem: requirePromptChain(chains, "navigatorBrief.system").text,
				driverImplementationSystem: requirePromptChain(chains, "driverImplementation.system").text,
				navigatorReviewSystem: requirePromptChain(chains, "navigatorReview.system").text,
				driverFixSystem: requirePromptChain(chains, "driverFix.system").text,
				navigatorBriefTemplate: requirePromptChain(chains, "navigatorBrief.template").text.split("\n"),
				driverImplementationTemplate: requirePromptChain(chains, "driverImplementation.template").text.split("\n"),
				navigatorReviewTemplate: requirePromptChain(chains, "navigatorReview.template").text.split("\n"),
				driverFixTemplate: requirePromptChain(chains, "driverFix.template").text.split("\n"),
			},
			files: args.params.files,
			specPath: args.params.specPath,
			maxFixPasses: args.params.limits?.maxFixPasses ?? args.team.limits.maxFixPasses,
			timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs,
			onProgress: (label) => {
				args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: ${label}`);
			},
		});
		recordPhase(args, "pair-coding");
		if (result.navigatorBrief) recordModelRun(args, "pair-coding", "navigator-brief", result.navigatorBrief);
		if (result.driverImplementation) recordModelRun(args, "pair-coding", "driver-implementation", result.driverImplementation);
		for (const [index, review] of result.reviews.entries()) recordModelRun(args, "pair-coding", `navigator-review:${index + 1}`, review);
		for (const [index, fix] of result.fixes.entries()) recordModelRun(args, "pair-coding", `driver-fix:${index + 1}`, fix);
		return formatWorkflowResult(result);
	},
};

const loweredGraphHandler: TeamHandler = {
	key: "lowered-graph",
	matches(team) {
		return team.protocol === "consult" || team.protocol === "telephone";
	},
	modelSlots(team, models) {
		if (team.protocol === "consult") {
			return [{ id: "navigator", label: "Navigator model", current: models.navigator, kind: "navigator" }];
		}
		return memberModelSlots({
			count: Math.max(models.members?.length ?? 0, team.agents.length, 1),
			label: (index) => `Relay model ${index + 1}`,
			models,
		});
	},
	async run(args) {
		const settings = resolveTeamSettings();
		const plan = graphPlanForSimpleProtocol({ team: args.team, params: args.params, settings });
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
	debateHandler,
	pairCodingHandler,
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
