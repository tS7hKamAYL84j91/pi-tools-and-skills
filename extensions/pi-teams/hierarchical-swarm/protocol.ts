/** Strict child-request protocol for hierarchical swarm orchestrators. */

import type { HierarchicalSwarmRole } from "../team-types.js";

export interface HierarchicalChildRequest {
	role: "manager" | "worker";
	prompt: string;
}

interface ChildRequestEnvelope {
	children: HierarchicalChildRequest[];
}

const FENCED_JSON = /^```json\n(\{"children":\[[\s\S]*\]\})\n```$/;

/**
 * Parses only the exact fenced JSON response format.  Narrative, additional
 * fences, unknown properties, and malformed requests deliberately spawn none.
 */
export function parseChildRequests(output: string): HierarchicalChildRequest[] {
	const match = FENCED_JSON.exec(output.trim());
	if (!match?.[1]) return [];
	try {
		const value: unknown = JSON.parse(match[1]);
		if (!isEnvelope(value)) return [];
		return value.children;
	} catch {
		return [];
	}
}

function isEnvelope(value: unknown): value is ChildRequestEnvelope {
	if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.children)) return false;
	return value.children.every(isRequest);
}

function isRequest(value: unknown): value is HierarchicalChildRequest {
	if (!isRecord(value) || Object.keys(value).length !== 2) return false;
	return (value.role === "manager" || value.role === "worker") && typeof value.prompt === "string" && value.prompt.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Returns the only permitted orchestrator instruction for a spawning role. */
export function childRequestInstructions(role: HierarchicalSwarmRole): string {
	if (role === "worker") return "You are a worker. Complete the assigned task directly; you cannot request or spawn children.";
	return "If delegation is needed, respond with exactly one fenced JSON block and nothing else: ```json\\n{\"children\":[{\"role\":\"manager\"|\"worker\",\"prompt\":\"task\"}]}\\n```. Otherwise complete the task directly.";
}
