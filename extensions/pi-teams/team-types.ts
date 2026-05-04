/**
 * Core declarative team types.
 */

import type { GenerationConfig } from "./types.js";

export type TeamProtocol = string;
export type TeamPromptRefs = Record<string, string>;
export type TeamSource = "builtin" | "user" | "project";
export type TeamWritableSource = Exclude<TeamSource, "builtin">;

export interface SubagentSpec extends GenerationConfig {
	id: string;
	name: string;
	description?: string;
	promptId?: string;
	model?: string;
	systemPrompt?: string;
	source: TeamSource;
	path: string;
}

export interface TeamModels {
	members?: string[];
	synthesis?: string;
	driver?: string;
	navigator?: string;
}

export interface TeamAgentBinding extends GenerationConfig {
	role: string;
	subagent: string;
	model?: string;
	label?: string;
	promptId?: string;
	templateId?: string;
	systemPrompt?: string;
	maxRetries?: number;
	subagentPromptId?: string;
	subagentSystemPrompt?: string;
}

export type TeamPromptSlotKind = "system" | "template";
export type TeamModelSlotKind = "member" | "synthesis" | "driver" | "navigator";
export type TeamModelSlotCount = number | "dynamic";

export interface TeamPromptContract {
	id: string;
	kind: TeamPromptSlotKind;
	defaultPromptId?: string;
	roles?: string[];
}

export interface TeamModelSlotSpec {
	id: string;
	kind: TeamModelSlotKind;
	count?: TeamModelSlotCount;
	label?: string;
}

export interface TeamLimits {
	timeoutMs?: number;
	maxFixPasses?: number;
	maxConcurrency?: number;
	maxRetries?: number;
}

export interface TeamSpec {
	schemaVersion: 2;
	id: string;
	name: string;
	description?: string;
	protocol: TeamProtocol;
	prompts: TeamPromptRefs;
	promptContracts?: TeamPromptContract[];
	modelSlots?: TeamModelSlotSpec[];
	agents: string[];
	agentBindings: TeamAgentBinding[];
	models: TeamModels;
	limits: TeamLimits;
	source: TeamSource;
	path: string;
}

export interface TeamRegistry {
	teams: Map<string, TeamSpec>;
	subagents: Map<string, SubagentSpec>;
	warnings: string[];
}

export interface TeamDirectories {
	root: string;
	agents: string;
	prompts: string;
	teams: string;
	source: TeamSource;
}

export interface TeamRegistryOptions {
	cwd?: string;
	settingsPath?: string;
	roots?: string[];
}
