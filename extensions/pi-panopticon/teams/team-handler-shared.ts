/**
 * Shared helpers for protocol-specific team handlers.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ok, type ToolResult } from "../../../lib/tool-result.js";
import type { TeamHandoff, TeamHandoffRouter } from "./handoff.js";
import { resolveSystemPrompt, resolveTemplatePrompt, type PromptCatalog, type ResolvedPromptChain } from "./prompt-resolver.js";
import { resolveTeamSettings } from "./settings.js";
import type { TeamStateManager } from "./state.js";
import { bindingForRole } from "./team-bindings.js";
import { nodeDetails, type NodeRun, runTeamNode } from "./team-node-runner.js";
import type { TeamAgentBinding, TeamModelSlotSpec, TeamModels, TeamPromptRefs, TeamSpec } from "./team-types.js";

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

export type TeamHandlerResult = ToolResult;

export interface TeamHandlerRunArgs {
	team: TeamSpec;
	params: TeamRunInput;
	ctx: ExtensionContext;
	stateManager: TeamStateManager;
	runId?: string;
	signal?: AbortSignal;
}

export interface TeamHandler {
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

export function memberModelSlots(args: {
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

export function recordPhase(args: TeamHandlerRunArgs, phaseId: string, label = phaseId): void {
	if (args.runId) args.stateManager.recordPhaseStarted(args.runId, phaseId, label);
}

export function recordDetail(args: TeamHandlerRunArgs, detail: { kind: "trace" | "handoff" | "fallback" | "artifact" | "error"; message: string; phaseId?: string; nodeId?: string; data?: Record<string, unknown> }): void {
	if (args.runId) args.stateManager.recordDetail(args.runId, detail);
}

export function recordHandoff(args: TeamHandlerRunArgs, router: TeamHandoffRouter, handoff: TeamHandoff): void {
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

/** Wrap runTeamNode with node_started/heartbeat/node_completed event emission. */
export async function runAndRecordNode(
	args: TeamHandlerRunArgs,
	phaseId: string,
	nodeArgs: Omit<Parameters<typeof runTeamNode>[0], "onHeartbeat">,
): Promise<NodeRun> {
	const nodeId = nodeArgs.role;
	const role = nodeArgs.binding.role;
	const model = nodeArgs.model;
	const runId = args.runId;
	if (runId) {
		args.stateManager.recordNodeStarted(runId, { phaseId, nodeId, role, model });
	}
	const node = await runTeamNode({
		...nodeArgs,
		...(runId ? {
			onHeartbeat: (elapsedMs: number, runningWorkers: number) => {
				args.stateManager.recordNodeHeartbeat(runId, { phaseId, nodeId, role, model, elapsedMs, runningWorkers });
			},
		} : {}),
	});
	recordNode(args, phaseId, node);
	return node;
}



function currentModelForSlot(slot: TeamModelSlotSpec, models: TeamModels, index: number): string | undefined {
	if (slot.kind === "member") return models.members?.[index];
	return models[slot.kind];
}

export function manifestModelSlots(team: TeamSpec, models: TeamModels): TeamModelSlot[] | undefined {
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

export function requireBinding(team: TeamSpec, roles: string[]): TeamAgentBinding {
	const binding = bindingForRole(team.agentBindings, roles) ?? team.agentBindings[0];
	if (!binding) throw new Error(`Team "${team.id}" needs at least one role binding.`);
	return binding;
}

export function councilSlots(team: TeamSpec): PromptSlot[] {
	if (team.protocol === "fusion") {
		return [
			{ id: "judge.system", kind: "system", defaultPromptId: "fusion/judge/system", roles: ["judge", "synthesis"] },
		];
	}
	if (team.protocol === "fusion-analysis") {
		return [
			{ id: "judge.system", kind: "system", defaultPromptId: "fusion/judge/system", roles: ["judge"] },
		];
	}
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

export function promptChains(team: TeamSpec, slots: readonly PromptSlot[]): ResolvedPromptChain[] {
	const catalog = resolveTeamSettings().prompts;
	return slots.map((slot) => resolvePromptSlot(team, catalog, slot));
}

export function chainText(chains: readonly ResolvedPromptChain[], slot: string): string {
	const chain = chains.find((entry) => entry.slot === slot);
	if (!chain) throw new Error(`Protocol prompt slot "${slot}" was not resolved.`);
	return chain.text;
}

export function stopRequested(args: TeamHandlerRunArgs): boolean {
	return args.runId !== undefined && args.stateManager.isStopRequested(args.runId);
}

export function formatElapsed(startedAt: number, completedAt?: number): string {
	const end = completedAt ?? Date.now();
	const elapsedMs = end - startedAt;
	const totalSeconds = Math.floor(elapsedMs / 1000);
	const m = Math.floor(totalSeconds / 60);
	const s = totalSeconds % 60;
	return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function stopReason(args: TeamHandlerRunArgs): string {
	return args.runId ? args.stateManager.stopReason(args.runId) ?? "stop requested" : "stop requested";
}

export function stoppedResult(args: TeamHandlerRunArgs, nodes: readonly NodeRun[]): TeamHandlerResult {
	return ok(`Team run stopped: ${stopReason(args)}`, { team: args.team.id, ok: false, stopped: true, reason: stopReason(args), nodes: nodeDetails(nodes) });
}

export function boundedLoopCount(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return 2;
	return Math.max(1, Math.min(Math.trunc(value), 5));
}
