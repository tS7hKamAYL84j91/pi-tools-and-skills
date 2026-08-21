/** ADR-040 compatibility helpers for legacy swarm entry points. */

import { loadTeamRegistry } from "../team-registry.js";
import type { TeamSpec } from "../team-types.js";

export const HIERARCHICAL_SWARM_TEAM_ID = "hierarchical-swarm-default";

interface SwarmCompatibilityPreflight {
	team: TeamSpec;
	text: string;
}

function requireHierarchicalSwarmTeam(cwd: string): TeamSpec {
	const team = loadTeamRegistry(undefined, { cwd }).teams.get(HIERARCHICAL_SWARM_TEAM_ID);
	if (!team?.hierarchicalSwarm) {
		throw new Error(`Swarm compatibility requires team "${HIERARCHICAL_SWARM_TEAM_ID}".`);
	}
	return team;
}

/** Formats dry-run information from the canonical hierarchical team manifest. */
export function preflightHierarchicalSwarm(args: {
	cwd: string;
	goal: string;
	profile: "fast" | "balanced" | "thorough";
	wip?: number;
}): SwarmCompatibilityPreflight {
	const team = requireHierarchicalSwarmTeam(args.cwd);
	const bounds = team.hierarchicalSwarm?.bounds;
	const configuredWip = bounds?.maxWip === undefined ? "unbounded" : String(bounds.maxWip);
	const requestedWip = args.wip === undefined ? "manifest default" : String(args.wip);
	return {
		team,
		text: [
			"Swarm dry run; no workers spawned.",
			`Goal: ${args.goal}`,
			`Profile: ${args.profile}`,
			`Team: ${team.id} (${team.protocol}).`,
			`WIP: requested ${requestedWip}; manifest ${configuredWip}.`,
			`Bounds: depth ${bounds?.maxDepth ?? "unbounded"}; children ${bounds?.maxChildrenPerNode ?? "unbounded"}; nodes ${bounds?.maxTotalNodes ?? "unbounded"}; TTL ${bounds?.ttlMs ?? "unbounded"}ms.`,
			`Next: rerun with dry_run:false using swarm_run({"goal":${JSON.stringify(args.goal)},"profile":"${args.profile}","dry_run":false})`,
		].join("\n"),
	};
}
