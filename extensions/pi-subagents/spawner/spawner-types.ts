/**
 * Types and interfaces for agent spawner.
 */

import type { SpawnedAgent } from "./spawn-service.js";
import type { TaskBrief } from "../../../lib/task-brief.js";
import type { AgentIdentity } from "../../../lib/agent-identity.js";

export interface ResultEnvelope {
	tool: string;
	params: Record<string, unknown>;
	result: Record<string, unknown>;
	durationMs: number;
	success: boolean;
	error?: string;
}

export interface SpawnAgentParams {
	name: string;
	task?: string;
	brief?: TaskBrief;
	cwd?: string;
	model?: string;
	tools?: string[];
	systemPrompt?: string;
	capsule?: string;
	sessionDir?: string;
}

export interface SpawnerContext {
	agents: Map<string, SpawnedAgent>;
	getParentIdentity: () => AgentIdentity;
	onAgentExit: (agent: SpawnedAgent) => void;
}
