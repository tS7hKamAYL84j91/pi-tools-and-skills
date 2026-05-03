/** Generic bounded DAG execution for graph-defined teams. */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { currentPanopticonRecord, runMember } from "./runner.js";
import { resolveTeamSettings } from "./settings.js";
import type { TeamAgentBinding, TeamGraphEdge, TeamSpec } from "./team-types.js";
import type { ModelRun } from "./types.js";
import { renderTemplate } from "./prompt-renderer.js";
import { promptAssetText } from "./prompt-resolver.js";
import { requirePromptChain, resolveProtocolPromptChains } from "./protocol-contracts.js";

/** @public */
export type GraphNodeStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";

/** @public */
export interface GraphValidationResult {
	roles: string[];
	roots: string[];
	sinks: string[];
	levels: string[][];
}

/** @public */
export interface GraphNodeResult {
	role: string;
	binding: TeamAgentBinding;
	status: GraphNodeStatus;
	ok: boolean;
	model?: string;
	run?: ModelRun;
	output: string;
	error?: string;
	startedAt?: number;
	completedAt?: number;
	durationMs?: number;
}

/** @public */
export interface GraphRunResult {
	id: string;
	output: string;
	ok: boolean;
	nodes: GraphNodeResult[];
	roots: string[];
	sinks: string[];
}

type GraphNodeRunner = (args: {
	binding: TeamAgentBinding;
	model: string;
	prompt: string;
	systemPrompt: string;
	signal: AbortSignal;
	parentId?: string;
	cwd: string;
}) => Promise<ModelRun>;

interface GraphNodePromptInput {
	prompt: string;
	systemPrompt: string;
}

export type GraphNodePromptBuilder = (args: {
	binding: TeamAgentBinding;
	model: string;
	originalPrompt: string;
	upstream: GraphNodeResult[];
	upstreamRoles: string[];
	completed: GraphNodeResult[];
	catalog: Record<string, readonly string[]>;
	defaultTemplate: string;
}) => GraphNodePromptInput;

interface GraphRunArgs {
	team: TeamSpec;
	prompt: string;
	ctx: ExtensionContext;
	timeoutMs?: number;
	maxConcurrency?: number;
	onProgress?: (text: string) => void;
	templateSlot?: string;
	runNode?: GraphNodeRunner;
	buildNodePrompt?: GraphNodePromptBuilder;
}

function edgesOf(team: TeamSpec): TeamGraphEdge[] {
	return team.graph?.edges ?? [];
}

function roleIndex(team: TeamSpec): Map<string, number> {
	return new Map(team.agentBindings.map((binding, index) => [binding.role, index]));
}

function incoming(role: string, edges: readonly TeamGraphEdge[]): string[] {
	return edges.filter((edge) => edge.to === role).map((edge) => edge.from);
}

function outgoing(role: string, edges: readonly TeamGraphEdge[]): string[] {
	return edges.filter((edge) => edge.from === role).map((edge) => edge.to);
}

function assertUniqueRoles(bindings: readonly TeamAgentBinding[]): string[] {
	const seen = new Set<string>();
	for (const binding of bindings) {
		if (binding.role.trim().length === 0) throw new Error("Team graph has an empty role.");
		if (seen.has(binding.role)) throw new Error(`Team graph has duplicate role "${binding.role}".`);
		seen.add(binding.role);
	}
	return bindings.map((binding) => binding.role);
}

function assertConnected(roles: readonly string[], edges: readonly TeamGraphEdge[]): void {
	if (roles.length <= 1) return;
	const seen = new Set<string>([roles[0] as string]);
	const queue = [roles[0] as string];
	while (queue.length > 0) {
		const role = queue.shift() as string;
		const neighbors = edges.flatMap((edge) => edge.from === role ? [edge.to] : edge.to === role ? [edge.from] : []);
		for (const next of neighbors) {
			if (seen.has(next)) continue;
			seen.add(next);
			queue.push(next);
		}
	}
	if (seen.size !== roles.length) throw new Error("Team graph is disconnected; every node must connect to the same DAG.");
}

function topologicalLevels(team: TeamSpec, roles: readonly string[], edges: readonly TeamGraphEdge[]): string[][] {
	const pending = new Set(roles);
	const completed = new Set<string>();
	const levels: string[][] = [];
	while (pending.size > 0) {
		const ready = roles.filter((role) => pending.has(role) && incoming(role, edges).every((source) => completed.has(source)));
		if (ready.length === 0) throw new Error("Team graph contains a cycle.");
		levels.push(ready);
		for (const role of ready) {
			pending.delete(role);
			completed.add(role);
		}
	}
	const index = roleIndex(team);
	return levels.map((level) => level.sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0)));
}

function modelForBinding(team: TeamSpec, binding: TeamAgentBinding): string | undefined {
	const index = roleIndex(team).get(binding.role);
	return binding.model ?? (index !== undefined ? team.models.members?.[index] : undefined);
}

/** @public */
export function validateTeamGraph(team: TeamSpec): GraphValidationResult {
	if (team.agentBindings.length === 0) throw new Error("Team graph must include at least one node.");
	const roles = assertUniqueRoles(team.agentBindings);
	const roleSet = new Set(roles);
	const seenEdges = new Set<string>();
	for (const edge of edgesOf(team)) {
		if (!roleSet.has(edge.from)) throw new Error(`Graph edge references unknown from role "${edge.from}".`);
		if (!roleSet.has(edge.to)) throw new Error(`Graph edge references unknown to role "${edge.to}".`);
		if (edge.from === edge.to) throw new Error(`Graph edge "${edge.from}" -> "${edge.to}" cannot target itself.`);
		const key = `${edge.from}->${edge.to}`;
		if (seenEdges.has(key)) throw new Error(`Team graph has duplicate edge ${edge.from} -> ${edge.to}.`);
		seenEdges.add(key);
	}
	if (team.graph?.reducer !== undefined && team.graph.reducer !== "concat") {
		throw new Error(`Unsupported graph reducer "${team.graph.reducer}"; supported reducers: concat.`);
	}
	for (const binding of team.agentBindings) {
		if (!modelForBinding(team, binding)) throw new Error(`Graph node "${binding.role}" needs a model binding.`);
	}
	assertConnected(roles, edgesOf(team));
	const levels = topologicalLevels(team, roles, edgesOf(team));
	const roots = roles.filter((role) => incoming(role, edgesOf(team)).length === 0);
	const sinks = roles.filter((role) => outgoing(role, edgesOf(team)).length === 0);
	const outputs = team.graph?.outputs ?? sinks;
	for (const output of outputs) {
		if (!roleSet.has(output)) throw new Error(`Graph output references unknown role "${output}".`);
	}
	if (outputs.length === 0) throw new Error("Team graph needs at least one output node.");
	return { roles, roots, sinks: outputs, levels };
}

function upstreamPackage(nodes: readonly GraphNodeResult[], upstreamRoles: readonly string[]): string {
	if (upstreamRoles.length === 0) return "(none)";
	const byRole = new Map(nodes.map((node) => [node.role, node]));
	return upstreamRoles.map((role) => {
		const node = byRole.get(role);
		if (!node) return `## ${role}\nStatus: skipped\nError: missing upstream result`;
		const label = node.binding.label ?? node.role;
		const lines = [`## ${node.role}`, `Label: ${label}`, `Status: ${node.status}`];
		if (node.model) lines.push(`Model: ${node.model}`);
		if (node.error) lines.push(`Error: ${node.error}`);
		if (node.output) lines.push("", node.output);
		return lines.join("\n");
	}).join("\n\n");
}

function graphSystemPrompt(binding: TeamAgentBinding, catalog: Record<string, readonly string[]>): string {
	if (binding.systemPrompt !== undefined) return binding.systemPrompt;
	if (binding.promptId !== undefined) return promptAssetText(catalog, binding.promptId);
	if (binding.subagentPromptId !== undefined) return promptAssetText(catalog, binding.subagentPromptId);
	return binding.subagentSystemPrompt ?? `You are ${binding.label ?? binding.role}.`;
}

function graphNodeTemplate(binding: TeamAgentBinding, catalog: Record<string, readonly string[]>, defaultTemplate: string): string {
	return binding.templateId !== undefined ? promptAssetText(catalog, binding.templateId) : defaultTemplate;
}

function defaultGraphNodePrompt(args: Parameters<GraphNodePromptBuilder>[0]): GraphNodePromptInput {
	return {
		prompt: renderTemplate(graphNodeTemplate(args.binding, args.catalog, args.defaultTemplate).split("\n"), {
			prompt: args.originalPrompt,
			role: args.binding.role,
			label: args.binding.label ?? args.binding.role,
			inputs: upstreamPackage(args.completed, args.upstreamRoles),
		}),
		systemPrompt: graphSystemPrompt(args.binding, args.catalog),
	};
}

function finalOutput(team: TeamSpec, validation: GraphValidationResult, nodes: readonly GraphNodeResult[]): string {
	const byRole = new Map(nodes.map((node) => [node.role, node]));
	const orderedOutputs = validation.sinks.sort((a, b) => (roleIndex(team).get(a) ?? 0) - (roleIndex(team).get(b) ?? 0));
	const blocks = orderedOutputs.flatMap((role) => {
		const node = byRole.get(role);
		return node?.ok && node.output ? [`## ${role}\n${node.output}`] : [];
	});
	if (blocks.length > 0) return blocks.join("\n\n");
	return orderedOutputs.map((role) => {
		const node = byRole.get(role);
		return `${role}: ${node?.status ?? "missing"}${node?.error ? ` (${node.error})` : ""}`;
	}).join("\n");
}

async function productionRunNode(args: Parameters<GraphNodeRunner>[0]): Promise<ModelRun> {
	return runMember(
		{
			label: args.binding.label ?? args.binding.role,
			model: args.model,
			...(args.binding.tools !== undefined ? { tools: args.binding.tools } : {}),
			...(args.binding.parameters !== undefined ? { parameters: args.binding.parameters } : {}),
		},
		{
			prompt: args.prompt,
			systemPrompt: args.systemPrompt,
			cwd: args.cwd,
			signal: args.signal,
			parentId: args.parentId,
		},
	);
}

function skippedNode(binding: TeamAgentBinding, model: string, error: string): GraphNodeResult {
	return { role: binding.role, binding, model, status: "skipped", ok: false, output: "", error };
}

async function runOneNode(args: {
	binding: TeamAgentBinding;
	team: TeamSpec;
	prompt: string;
	upstream: GraphNodeResult[];
	ctx: ExtensionContext;
	parentId?: string;
	timeoutMs?: number;
	runNode: GraphNodeRunner;
	template: string;
	catalog: Record<string, readonly string[]>;
	buildNodePrompt: GraphNodePromptBuilder;
}): Promise<GraphNodeResult> {
	const model = modelForBinding(args.team, args.binding) as string;
	const upstreamRoles = incoming(args.binding.role, edgesOf(args.team));
	const upstream = args.upstream.filter((node) => upstreamRoles.includes(node.role));
	const failedUpstream = upstream.find((node) => !node.ok);
	if (failedUpstream && args.binding.dependencyPolicy !== "allow-failed") {
		return skippedNode(args.binding, model, `upstream ${failedUpstream.role} ${failedUpstream.status}`);
	}
	const inputs = args.buildNodePrompt({
		binding: args.binding,
		model,
		originalPrompt: args.prompt,
		upstream,
		upstreamRoles,
		completed: args.upstream,
		catalog: args.catalog,
		defaultTemplate: args.template,
	});
	const controller = new AbortController();
	const timeout = args.timeoutMs ? setTimeout(() => controller.abort(), args.timeoutMs) : undefined;
	const onParentAbort = () => controller.abort();
	args.ctx.signal?.addEventListener("abort", onParentAbort, { once: true });
	const startedAt = Date.now();
	try {
		const run = await args.runNode({
			binding: args.binding,
			model,
			prompt: inputs.prompt,
			systemPrompt: inputs.systemPrompt,
			signal: controller.signal,
			parentId: args.parentId,
			cwd: args.ctx.cwd,
		});
		const status = run.ok ? "succeeded" : controller.signal.aborted && args.ctx.signal?.aborted ? "cancelled" : "failed";
		return {
			role: args.binding.role,
			binding: args.binding,
			status,
			ok: run.ok,
			model,
			run,
			output: run.output,
			...(run.error ? { error: run.error } : {}),
			startedAt,
			completedAt: Date.now(),
			durationMs: run.durationMs,
		};
	} catch (error) {
		const message = controller.signal.aborted && !args.ctx.signal?.aborted ? "timeout" : error instanceof Error ? error.message : String(error);
		return { role: args.binding.role, binding: args.binding, status: "failed", ok: false, model, output: "", error: message, startedAt, completedAt: Date.now(), durationMs: Date.now() - startedAt };
	} finally {
		if (timeout) clearTimeout(timeout);
		args.ctx.signal?.removeEventListener("abort", onParentAbort);
	}
}

async function runLevel(args: {
	level: string[];
	team: TeamSpec;
	prompt: string;
	completed: GraphNodeResult[];
	ctx: ExtensionContext;
	parentId?: string;
	timeoutMs?: number;
	maxConcurrency: number;
	runNode: GraphNodeRunner;
	template: string;
	catalog: Record<string, readonly string[]>;
	buildNodePrompt: GraphNodePromptBuilder;
	onProgress?: (text: string) => void;
}): Promise<GraphNodeResult[]> {
	const pending = [...args.level];
	const running = new Set<Promise<GraphNodeResult>>();
	const results: GraphNodeResult[] = [];
	const bindings = new Map(args.team.agentBindings.map((binding) => [binding.role, binding]));
	while (pending.length > 0 || running.size > 0) {
		while (pending.length > 0 && running.size < args.maxConcurrency) {
			const role = pending.shift() as string;
			const binding = bindings.get(role) as TeamAgentBinding;
			args.onProgress?.(`graph node ${role}`);
			const task = runOneNode({ ...args, binding, upstream: args.completed });
			running.add(task);
			task.finally(() => running.delete(task)).catch(() => undefined);
		}
		const result = await Promise.race(running);
		results.push(result);
	}
	return results.sort((a, b) => (roleIndex(args.team).get(a.role) ?? 0) - (roleIndex(args.team).get(b.role) ?? 0));
}

export async function runTeamGraph(args: GraphRunArgs): Promise<GraphRunResult> {
	const validation = validateTeamGraph(args.team);
	const maxConcurrency = args.maxConcurrency ?? args.team.limits.maxConcurrency ?? 4;
	if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) throw new Error("Graph maxConcurrency must be a positive integer.");
	const parentId = (await currentPanopticonRecord(args.ctx.cwd))?.id;
	const catalog = resolveTeamSettings().prompts;
	const chains = resolveProtocolPromptChains({ protocol: args.team.protocol, prompts: args.team.prompts, bindings: args.team.agentBindings }, catalog);
	const template = requirePromptChain(chains, args.templateSlot ?? "node.template").text;
	const runNode = args.runNode ?? productionRunNode;
	const buildNodePrompt = args.buildNodePrompt ?? defaultGraphNodePrompt;
	const nodes: GraphNodeResult[] = [];
	for (const level of validation.levels) {
		if (args.ctx.signal?.aborted) {
			for (const role of level) {
				const binding = args.team.agentBindings.find((entry) => entry.role === role) as TeamAgentBinding;
				nodes.push({ role, binding, status: "cancelled", ok: false, model: modelForBinding(args.team, binding), output: "", error: "cancelled" });
			}
			continue;
		}
		nodes.push(...await runLevel({
			level,
			team: args.team,
			prompt: args.prompt,
			completed: nodes,
			ctx: args.ctx,
			parentId,
			timeoutMs: args.timeoutMs,
			maxConcurrency,
			runNode,
			template,
			catalog,
			buildNodePrompt,
			onProgress: args.onProgress,
		}));
	}
	return {
		id: `graph-${Date.now().toString(36)}`,
		output: finalOutput(args.team, validation, nodes),
		ok: nodes.every((node) => node.ok),
		nodes,
		roots: validation.roots,
		sinks: validation.sinks,
	};
}
