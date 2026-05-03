/** Generic DAG execution for graph-defined teams. */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { currentPanopticonRecord, runMember } from "./runner.js";
import { resolveCouncilSettings } from "./settings.js";
import type { TeamAgentBinding, TeamGraphEdge, TeamSpec } from "./team-types.js";
import type { ModelRun } from "./types.js";
import { renderTemplate } from "./prompt-renderer.js";

interface GraphRunArgs {
	team: TeamSpec;
	prompt: string;
	ctx: ExtensionContext;
	timeoutMs?: number;
	onProgress?: (text: string) => void;
}

interface GraphNodeResult {
	binding: TeamAgentBinding;
	run: ModelRun;
}

interface GraphRunResult {
	output: string;
	ok: boolean;
	nodes: GraphNodeResult[];
}

function roleSet(bindings: TeamAgentBinding[]): Set<string> {
	return new Set(bindings.map((binding) => binding.role));
}

function validateEdges(bindings: TeamAgentBinding[], edges: TeamGraphEdge[]): void {
	const roles = roleSet(bindings);
	for (const edge of edges) {
		if (!roles.has(edge.from)) throw new Error(`Graph edge references unknown role "${edge.from}".`);
		if (!roles.has(edge.to)) throw new Error(`Graph edge references unknown role "${edge.to}".`);
	}
}

function upstreamRoles(role: string, edges: TeamGraphEdge[]): string[] {
	return edges.filter((edge) => edge.to === role).map((edge) => edge.from);
}

function sinkRoles(bindings: TeamAgentBinding[], edges: TeamGraphEdge[]): string[] {
	const fromRoles = new Set(edges.map((edge) => edge.from));
	const sinks = bindings.map((binding) => binding.role).filter((role) => !fromRoles.has(role));
	return sinks.length > 0 ? sinks : bindings.slice(-1).map((binding) => binding.role);
}

function orderedBindings(bindings: TeamAgentBinding[], edges: TeamGraphEdge[]): TeamAgentBinding[] {
	const pending = new Map(bindings.map((binding) => [binding.role, binding]));
	const completed = new Set<string>();
	const ordered: TeamAgentBinding[] = [];
	while (pending.size > 0) {
		const ready = [...pending.values()].filter((binding) =>
			upstreamRoles(binding.role, edges).every((role) => completed.has(role)),
		);
		if (ready.length === 0) throw new Error("Team graph contains a cycle or disconnected dependency.");
		for (const binding of ready) {
			ordered.push(binding);
			pending.delete(binding.role);
			completed.add(binding.role);
		}
	}
	return ordered;
}

function formatInputs(upstream: GraphNodeResult[]): string {
	if (upstream.length === 0) return "(none)";
	return upstream.map((node) => `## ${node.binding.role}\n${node.run.output}`).join("\n\n");
}

export async function runTeamGraph(args: GraphRunArgs): Promise<GraphRunResult> {
	const edges = args.team.graph?.edges ?? [];
	validateEdges(args.team.agentBindings, edges);
	const ordered = orderedBindings(args.team.agentBindings, edges);
	const results = new Map<string, GraphNodeResult>();
	const parentId = (await currentPanopticonRecord(args.ctx.cwd))?.id;
	const promptsConfig = resolveCouncilSettings().prompts;
	for (const binding of ordered) {
		const upstream = upstreamRoles(binding.role, edges)
			.map((role) => results.get(role))
			.filter((result): result is GraphNodeResult => result !== undefined);
		args.onProgress?.(`graph node ${binding.role}`);
		const model = binding.model ?? args.team.models.members?.[0];
		if (!model) throw new Error(`Graph node "${binding.role}" needs a model binding.`);
		const prompt = renderTemplate(promptsConfig.teamGraphNodeTemplate, {
			prompt: args.prompt,
			role: binding.role,
			inputs: formatInputs(upstream),
		});
		const controller = new AbortController();
		const timer = args.timeoutMs ? setTimeout(() => controller.abort(), args.timeoutMs) : undefined;
		const onParentAbort = () => controller.abort();
		args.ctx.signal?.addEventListener("abort", onParentAbort, { once: true });
		try {
			const run = await runMember(
				{
					label: binding.label ?? binding.role,
					model,
					...(binding.tools ? { tools: binding.tools } : {}),
					...(binding.parameters ? { parameters: binding.parameters } : {}),
				},
				{
					prompt,
					systemPrompt: binding.systemPrompt ?? binding.subagent,
					cwd: args.ctx.cwd,
					signal: controller.signal,
					parentId,
				},
			);
			results.set(binding.role, { binding, run });
		} finally {
			if (timer) clearTimeout(timer);
			args.ctx.signal?.removeEventListener("abort", onParentAbort);
		}
	}
	const nodes = [...results.values()];
	const output = sinkRoles(args.team.agentBindings, edges)
		.map((role) => results.get(role)?.run.output)
		.filter((text): text is string => text !== undefined && text.length > 0)
		.join("\n\n");
	return { output: output || "(no graph output)", ok: nodes.every((node) => node.run.ok), nodes };
}
