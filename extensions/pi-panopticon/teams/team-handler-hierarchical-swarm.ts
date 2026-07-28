/** Hierarchical swarm handler for ADR-040 phase 1 */
import { ok } from "../../../lib/tool-result.js";
import { currentPanopticonRecord } from "./runner.js";
import { nodeDetails } from "./team-node-runner.js";
import type { TeamHandler, TeamHandlerResult, TeamHandlerRunArgs } from "./team-handler-shared.js";
import { TEAM_STATUS_KEY, recordDetail, recordPhase, runAndRecordNode, stoppedResult, stopRequested } from "./team-handler-shared.js";

async function runHierarchicalSwarm(args: TeamHandlerRunArgs): Promise<TeamHandlerResult> {
	const hierarchy = args.team.hierarchicalSwarm;
	if (!hierarchy) throw new Error("hierarchical-swarm teams require hierarchicalSwarm configuration.");

	const rootTemplate = hierarchy.roleTemplates.find((rt) => rt.role === "root");
	if (!rootTemplate) throw new Error("hierarchical-swarm requires a root role template.");

	const rootBinding = args.team.agentBindings.find((b) => b.role === rootTemplate.bindingRole);
	if (!rootBinding) throw new Error(`hierarchical-swarm root binding role '${rootTemplate.bindingRole}' not found.`);

	const model = rootBinding.model;
	if (!model) throw new Error("hierarchical-swarm root binding requires a model.");

	const parent = await currentPanopticonRecord(args.ctx.cwd);
	
	recordPhase(args, "tree");
	args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: root node`);

	recordDetail(args, { kind: "trace", phaseId: "tree", nodeId: "root", message: "hierarchical-swarm root selected", data: { role: rootBinding.role, model } });

	const node = await runAndRecordNode(args, "tree", {
		binding: rootBinding,
		role: "root",
		model,
		prompt: args.params.prompt,
		systemPrompt: rootBinding.systemPrompt ?? "",
		ctx: args.ctx,
		signal: args.signal,
		parentId: parent?.id,
		orchestratorName: parent?.name,
		timeoutMs: args.params.limits?.timeoutMs ?? hierarchy.bounds.ttlMs,
		maxRetries: args.params.limits?.maxRetries,
	});

	if (stopRequested(args)) return stoppedResult(args, [node]);
	
	return ok(node.output, { team: args.team.id, ok: node.ok, nodes: nodeDetails([node]) });
}

export const hierarchicalSwarmHandler: TeamHandler = {
	key: "hierarchical-swarm",
	matches(team) {
		return team.protocol === "hierarchical-swarm";
	},
	modelSlots() {
		return [];
	},
	async run(args) {
		return runHierarchicalSwarm(args);
	},
};
