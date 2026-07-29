/** Hierarchical swarm handler for ADR-040 dynamic tree execution. */

import { ok } from "../../../lib/tool-result.js";
import { executeHierarchicalTree } from "./hierarchical-swarm/executor.js";
import { nodeDetails } from "./team-node-runner.js";
import type { TeamHandler, TeamHandlerResult, TeamHandlerRunArgs } from "./team-handler-shared.js";
import { TEAM_STATUS_KEY, recordPhase, stoppedResult, stopRequested } from "./team-handler-shared.js";

async function runHierarchicalSwarm(args: TeamHandlerRunArgs): Promise<TeamHandlerResult> {
	if (stopRequested(args)) return stoppedResult(args, []);
	recordPhase(args, "tree");
	args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: hierarchical tree`);
	const root = await executeHierarchicalTree(args);
	if (stopRequested(args) || args.signal?.aborted) return stoppedResult(args, [root]);
	return ok(root.output, { team: args.team.id, ok: root.ok, nodes: nodeDetails([root]) });
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
