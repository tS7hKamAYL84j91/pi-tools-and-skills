/**
 * Core declarative team types.
 */

import type { GenerationConfig } from "./types.js";

export type TeamTopology = "chain" | "council" | "pair";
export type TeamProtocol = "debate" | "consult" | "graph" | "pair-coding" | "telephone";
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
	chairman?: string;
	driver?: string;
	navigator?: string;
}

export interface TeamAgentBinding extends GenerationConfig {
	role: string;
	subagent: string;
	model?: string;
	label?: string;
	systemPrompt?: string;
}

export interface TeamLimits {
	timeoutMs?: number;
	maxFixPasses?: number;
}

export interface TeamGraphEdge {
	from: string;
	to: string;
}

export interface TeamGraph {
	edges: TeamGraphEdge[];
}

export interface TeamSpec {
	schemaVersion: 1;
	id: string;
	name: string;
	description?: string;
	topology: TeamTopology;
	protocol: TeamProtocol;
	agents: string[];
	agentBindings: TeamAgentBinding[];
	graph?: TeamGraph;
	chair?: string;
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
