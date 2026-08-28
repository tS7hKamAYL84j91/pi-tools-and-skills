/**
 * Pure AgentRecord helpers extracted from the Registry module (split per the
 * line-budget fitness test): status symbols, record building, display-name
 * selection, and ordering. No IO — callers supply timestamps and records.
 */

import { basename } from "node:path";
import type {
	AgentNameSource,
	AgentRecord,
	AgentStatus,
} from "../../../lib/agent-registry.js";

export const STATUS_SYMBOL: Record<AgentStatus, string> = {
	running: "R",
	waiting: "W",
	done: "D",
	blocked: "B",
	stalled: "S",
	terminated: "X",
	unknown: "?",
};

/**
 * Build a record with updated heartbeat, status, and task.
 * Pure — caller supplies the timestamp.
 * @internal exported for tests
 */
export function buildRecord(
	base: AgentRecord,
	status: AgentStatus,
	task: string | undefined,
	now: number,
): AgentRecord {
	return { ...base, heartbeat: now, status, task };
}

/**
 * Format uptime as human-readable duration (e.g. "5m", "42s").
 * @internal exported for tests
 */
export function formatAge(startedAt: number): string {
	const secs = Math.round((Date.now() - startedAt) / 1000);
	return secs < 60 ? `${secs}s` : `${Math.round(secs / 60)}m`;
}

/**
 * Check if a name is already taken by another agent.
 * Case-insensitive; ignores self.
 * @internal exported for tests
 */
export function nameTaken(
	name: string,
	records: AgentRecord[],
	selfId: string,
): boolean {
	const lower = name.toLowerCase();
	return records.some((r) => r.name.toLowerCase() === lower && r.id !== selfId);
}

/**
 * Pick a unique name for this agent.
 * Starts with basename(cwd), then tries cwd-2, cwd-3, etc.
 * Falls back to cwd-{first 6 chars of id}.
 * @internal exported for tests
 */
export function pickName(
	cwd: string,
	records: AgentRecord[],
	selfId: string,
	requestedName?: string,
): string {
	const base = requestedName || basename(cwd) || "agent";
	if (!nameTaken(base, records, selfId)) return base;
	for (let i = 2; i < 100; i++) {
		const candidate = `${base}-${i}`;
		if (!nameTaken(candidate, records, selfId)) return candidate;
	}
	return `${base}-${selfId.slice(0, 6)}`;
}

interface PickActiveNameInput {
	cwd: string;
	records: AgentRecord[];
	selfId: string;
	sessionName?: string;
	spawnName?: string;
}

/** Resolve active name by precedence: session/programmatic > spawn > generated. */
export function pickActiveName(input: PickActiveNameInput): {
	name: string;
	source: AgentNameSource;
} {
	if (input.sessionName) {
		return { name: input.sessionName, source: "user" };
	}
	if (input.spawnName) {
		return {
			name: pickName(input.cwd, input.records, input.selfId, input.spawnName),
			source: "spawn",
		};
	}
	return {
		name: pickName(input.cwd, input.records, input.selfId),
		source: "generated",
	};
}

/**
 * Sort records: self first, then by startedAt.
 * @internal exported for tests
 */
export function sortRecords(
	records: AgentRecord[],
	selfId: string,
): AgentRecord[] {
	return [...records].sort((a, b) => {
		if (a.id === selfId) return -1;
		if (b.id === selfId) return 1;
		return a.startedAt - b.startedAt;
	});
}
