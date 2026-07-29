/** ADR-040 Teams compatibility aliases for legacy swarm tools. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { fail, ok } from "../../../lib/tool-result.js";
import type { TeamsFacade } from "../teams/register.js";
import { HIERARCHICAL_SWARM_TEAM_ID, preflightHierarchicalSwarm } from "./swarm-compat.js";

const ProfileSchema = Type.Union([
	Type.Literal("fast"),
	Type.Literal("balanced"),
	Type.Literal("thorough"),
]);

interface SwarmRegistration {
	teams: TeamsFacade;
}

function compatibilityRuns(registration: SwarmRegistration) {
	return registration.teams.stateManager.list().filter((run) => run.team === HIERARCHICAL_SWARM_TEAM_ID);
}

/** Registers swarm aliases that share the Teams run lifecycle. */
export function registerSwarmTools(pi: ExtensionAPI, registration: SwarmRegistration): void {
	pi.registerTool({
		name: "swarm_run",
		label: "Run Swarm",
		description: "Compatibility alias for team_run hierarchical-swarm-default. Dry-run defaults to true.",
		parameters: Type.Object({
			goal: Type.String(),
			profile: Type.Optional(ProfileSchema),
			wip: Type.Optional(Type.Number()),
			dry_run: Type.Optional(Type.Boolean({ default: true })),
			async: Type.Optional(Type.Boolean({ default: false })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (params.wip !== undefined) {
				return fail("swarm_run wip is unsupported by the compatibility alias; configure hierarchical-swarm bounds in the team manifest.", { code: "validation" });
			}
			const profile = params.profile ?? "balanced";
			if (params.dry_run !== false) {
				try {
					const preflight = preflightHierarchicalSwarm({ cwd: ctx.cwd, goal: params.goal, profile });
					return ok(preflight.text, { team: preflight.team.id, dryRun: true, compatibility: "hierarchical-swarm" });
				} catch (error) {
					return fail(error instanceof Error ? error.message : String(error), { code: "validation" });
				}
			}
			const teamParams = { id: HIERARCHICAL_SWARM_TEAM_ID, prompt: params.goal, profile, ...(params.async ? { async: true } : {}) };
			return params.async ? registration.teams.runAsync(teamParams, ctx) : registration.teams.run(teamParams, ctx);
		},
	});

	pi.registerTool({
		name: "swarm_status",
		label: "Swarm Status",
		description: "Compatibility view of a hierarchical-swarm Teams run.",
		parameters: Type.Object({ swarmId: Type.String() }),
		async execute(_id, params) {
			const run = registration.teams.stateManager.get(params.swarmId);
			if (!run || run.team !== HIERARCHICAL_SWARM_TEAM_ID) {
				return fail(`No hierarchical-swarm team run "${params.swarmId}". Legacy swarm IDs are not available; use team_runs.`, { code: "validation" });
			}
			return ok(`${run.id} ${run.status} nodes=${run.nodes.length}`, { run, compatibility: "hierarchical-swarm" });
		},
	});

	pi.registerTool({
		name: "swarm_list",
		label: "List Swarms",
		description: "Compatibility list of hierarchical-swarm Teams runs.",
		parameters: Type.Object({ activeOnly: Type.Optional(Type.Boolean()) }),
		async execute(_id, params) {
			const runs = compatibilityRuns(registration).filter((run) => !params.activeOnly || run.status === "pending" || run.status === "running" || run.status === "stopping");
			return ok(runs.length === 0 ? "No hierarchical-swarm team runs." : runs.map((run) => `${run.id} ${run.status} nodes=${run.nodes.length}`).join("\n"), { runs, compatibility: "hierarchical-swarm" });
		},
	});

	pi.registerTool({
		name: "swarm_stop",
		label: "Stop Swarm",
		description: "Compatibility stop for a hierarchical-swarm Teams run.",
		parameters: Type.Object({ swarmId: Type.String(), reason: Type.Optional(Type.String()) }),
		async execute(_id, params) {
			const run = registration.teams.stateManager.get(params.swarmId);
			if (!run || run.team !== HIERARCHICAL_SWARM_TEAM_ID) {
				return fail(`No hierarchical-swarm team run "${params.swarmId}". Legacy swarm IDs cannot be stopped.`, { code: "validation" });
			}
			const stopped = registration.teams.stateManager.requestStop(run.id, params.reason ?? "cancelled by swarm compatibility alias");
			return stopped
				? ok(`Team run ${run.id} stopping.`, { runId: run.id, compatibility: "hierarchical-swarm" })
				: fail(`Team run ${run.id} is not active.`, { code: "validation" });
		},
	});
}
