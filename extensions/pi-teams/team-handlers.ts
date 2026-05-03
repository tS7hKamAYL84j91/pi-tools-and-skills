/**
 * Protocol-specific team execution handlers and model slot metadata.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { resolveTeamSettings } from "./settings.js";
import type { TeamStateManager } from "./state.js";
import { roleBindings } from "./team-bindings.js";
import { type GraphRunResult, runTeamGraph } from "./team-graph.js";
import { graphPlanForSimpleProtocol } from "./team-lowering.js";
import type { TeamModels, TeamSpec } from "./team-types.js";

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
		attempts: node.attempts,
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
			maxRetries: args.params.limits?.maxRetries,
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
			nodes: graphNodeDetails(result),
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
					count: Math.max(models.members?.length ?? 0, roleBindings(team.agentBindings, ["member"]).length, 1),
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
			maxRetries: args.params.limits?.maxRetries,
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
