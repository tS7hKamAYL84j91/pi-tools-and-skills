/**
 * Types and interfaces for agent spawner.
 */

import type { TaskBrief } from "../../lib/task-brief.js";

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
