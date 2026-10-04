/**
 * Shared types for team form creation and mutation helpers.
 */

import type { TeamAgentBinding, TeamModels, TeamProtocol, TeamWritableSource } from "./team-types.js";

export type TeamFormScope = TeamWritableSource;
export type TeamFormProtocol = TeamProtocol;

export interface TeamFormModels extends TeamModels {}

export interface TeamFormLimits {
	maxFixPasses?: number;
	timeoutMs?: number;
	maxConcurrency?: number;
	maxRetries?: number;
	maxLoops?: number;
}

export interface TeamFormInput {
	id: string;
	name?: string;
	description?: string;
	protocol: TeamFormProtocol;
	agents: string[];
	agentBindings?: TeamAgentBinding[];
	prompts?: Record<string, string>;
	models?: TeamFormModels;
	limits?: TeamFormLimits;
	scope?: TeamFormScope;
	overwrite?: boolean;
}
