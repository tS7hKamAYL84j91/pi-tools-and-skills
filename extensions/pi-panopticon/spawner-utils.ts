/**
 * Helper utilities for agent spawner.
 */

import type { ResultEnvelope, SpawnAgentParams } from "./spawner-types.js";

export function createResultEnvelope(args: {
	tool: string;
	params: Record<string, unknown>;
	result: Record<string, unknown>;
	startedAt: number;
	success: boolean;
	error?: string;
}): ResultEnvelope {
	return {
		tool: args.tool,
		params: args.params,
		result: args.result,
		durationMs: Date.now() - args.startedAt,
		success: args.success,
		...(args.error ? { error: args.error } : {}),
	};
}

/** Normalize legacy/model-emitted spawn_agent args before TypeBox validation. */
export function prepareSpawnAgentArguments(args: unknown): SpawnAgentParams {
	if (args == null || typeof args !== "object" || Array.isArray(args)) {
		// Preserve invalid shapes for the schema validator to reject.
		return args as SpawnAgentParams;
	}
	// Tool arguments arrive as unknown JSON; object guard makes record access safe.
	const input = args as Record<string, unknown>;
	if (input.tools !== null) {
		// Preserve any other validation errors for the schema validator.
		return input as unknown as SpawnAgentParams;
	}
	return { ...input, tools: [] } as unknown as SpawnAgentParams;
}
