/**
 * Types and interfaces for agent spawner.
 */

import type { SpawnedAgent } from "./spawn-service.js";
import type { TaskBrief } from "../../../lib/task-brief.js";
import type { Registry } from "../types.js";

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
	sessionDir?: string;
}

export interface SpawnerContext {
	agents: Map<string, SpawnedAgent>;
	registry: Registry;
	onAgentExit: (agent: SpawnedAgent) => void;
}
