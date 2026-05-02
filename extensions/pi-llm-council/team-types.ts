/**
 * Core declarative team types.
 */

export type TeamTopology = "chain" | "council" | "pair";
export type TeamProtocol = "debate" | "consult" | "pair-coding" | "telephone";
export type TeamSource = "builtin" | "user" | "project";
export type TeamWritableSource = Exclude<TeamSource, "builtin">;

export interface SubagentSpec {
	id: string;
	name: string;
	description?: string;
	promptId?: string;
	model?: string;
	source: TeamSource;
	path: string;
}

export interface TeamModels {
	members?: string[];
	chairman?: string;
	driver?: string;
	navigator?: string;
}

export interface TeamAgentBinding {
	role: string;
	subagent: string;
	model?: string;
	label?: string;
}

export interface TeamLimits {
	timeoutMs?: number;
	maxFixPasses?: number;
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
	subagents: string;
	teams: string;
	source: TeamSource;
}

export interface TeamRegistryOptions {
	cwd?: string;
	userRoot?: string;
}
