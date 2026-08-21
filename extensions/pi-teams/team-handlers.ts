/**
 * Protocol-specific team execution handler registry and model slot metadata.
 */

import { consultHandler } from "./team-handler-consult.js";
import { debateHandler } from "./team-handler-debate.js";
import { hierarchicalSwarmHandler } from "./team-handler-hierarchical-swarm.js";
import { researchHandler } from "./team-handler-research.js";
import { councilSlots, manifestModelSlots, promptChains, TEAM_STATUS_KEY } from "./team-handler-shared.js";
import type { TeamHandler, TeamModelSlot, TeamRunInput } from "./team-handler-shared.js";
import type { TeamModels, TeamSpec } from "./team-types.js";

export { TEAM_STATUS_KEY };
export type { TeamModelSlot, TeamRunInput };

const TEAM_HANDLERS: readonly TeamHandler[] = [
	consultHandler,
	debateHandler,
	hierarchicalSwarmHandler,
	researchHandler,
];

export function getTeamHandler(team: TeamSpec): TeamHandler | undefined {
	return TEAM_HANDLERS.find((handler) => handler.matches(team));
}

export function modelSlotsForTeam(team: TeamSpec, models: TeamModels): TeamModelSlot[] {
	const manifestSlots = manifestModelSlots(team, models);
	if (manifestSlots) return manifestSlots;
	const handler = getTeamHandler(team);
	if (!handler) return [];
	return handler.modelSlots(team, models);
}

export function promptChainsForTeam(team: TeamSpec) {
	const handler = getTeamHandler(team);
	if (!handler) return [];
	return promptChains(team, councilSlots(team));
}
