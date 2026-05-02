/**
 * Compatibility barrel for declarative team APIs.
 *
 * New code should import from team-types, team-registry, team-defaults, or
 * team-tools directly. This file preserves the pre-refactor module path.
 */

import { ensureUserTeamDefaults as ensureUserTeamDefaultsImpl } from "./team-defaults.js";
import {
	loadBuiltinTeamIds as loadBuiltinTeamIdsImpl,
	loadTeamRegistry as loadTeamRegistryImpl,
	requireBuiltinTeam as requireBuiltinTeamImpl,
	teamToCouncilDefinition as teamToCouncilDefinitionImpl,
	teamToPairDefinition as teamToPairDefinitionImpl,
} from "./team-registry.js";
import { registerTeamTools as registerTeamToolsImpl } from "./team-tools.js";
import type {
	TeamAgentBinding as TeamAgentBindingType,
	TeamLimits as TeamLimitsType,
	TeamModels as TeamModelsType,
	TeamProtocol as TeamProtocolType,
	TeamSource as TeamSourceType,
	TeamSpec as TeamSpecType,
	TeamTopology as TeamTopologyType,
} from "./team-types.js";

/** @public */
export type TeamTopology = TeamTopologyType;
/** @public */
export type TeamProtocol = TeamProtocolType;
/** @public */
export type TeamSource = TeamSourceType;
/** @public */
export type TeamModels = TeamModelsType;
/** @public */
export type TeamAgentBinding = TeamAgentBindingType;
/** @public */
export type TeamLimits = TeamLimitsType;
/** @public */
export type TeamSpec = TeamSpecType;

/** @public */
export const ensureUserTeamDefaults = ensureUserTeamDefaultsImpl;
/** @public */
export const loadTeamRegistry = loadTeamRegistryImpl;
/** @public */
export const loadBuiltinTeamIds = loadBuiltinTeamIdsImpl;
/** @public */
export const requireBuiltinTeam = requireBuiltinTeamImpl;
/** @public */
export const teamToCouncilDefinition = teamToCouncilDefinitionImpl;
/** @public */
export const teamToPairDefinition = teamToPairDefinitionImpl;
/** @public */
export const registerTeamTools = registerTeamToolsImpl;
