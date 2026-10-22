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
import { isValidAgentName } from "../../../lib/agent-registry.js";

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
	/** Declared panopticon name from project launch metadata (root agents only). */
	declaredName?: string;
	/** Lower-cased lead labels reserved for other owners; never claimable here. */
	reservedNames?: readonly string[];
}

/**
 * Pick a variant of `base` unique among live peers and not reserved:
 * appends -2, -3, … then falls back to a self-id suffix.
 */
function uniqueName(
	base: string,
	input: PickActiveNameInput,
): string {
	const reserved = input.reservedNames ?? [];
	const isClaimable = (candidate: string) =>
		!nameTaken(candidate, input.records, input.selfId) &&
		!reserved.includes(candidate.toLowerCase());
	if (isClaimable(base)) return base;
	for (let i = 2; i < 100; i++) {
		const candidate = `${base}-${i}`;
		if (isClaimable(candidate)) return candidate;
	}
	return `${base}-${input.selfId.slice(0, 6)}`;
}

/**
 * Resolve active name by precedence: session > spawn > declared > generated.
 *
 * Session and declared names are claims, not entitlements: a name already held
 * by a different live agent, or reserved in the durable ownership journal for
 * another lead, is skipped (never silently duplicated) so a rename cannot
 * shadow or deny-service another agent's routing. Spawned agents always have a
 * spawn name, so they never fall through to the project's declared lead label.
 */
export function pickActiveName(input: PickActiveNameInput): {
	name: string;
	source: AgentNameSource;
} {
	const reserved = input.reservedNames ?? [];
	const isClaimable = (candidate: string) =>
		!nameTaken(candidate, input.records, input.selfId) &&
		!reserved.includes(candidate.toLowerCase());
	// Unsafe claim strings (containing "/" or "#") are treated as absent so a
	// plain name can never equal a derived qualified or disambiguated label.
	const safeSessionName =
		input.sessionName && isValidAgentName(input.sessionName) ? input.sessionName : undefined;
	const safeSpawnName =
		input.spawnName && isValidAgentName(input.spawnName) ? input.spawnName : undefined;
	const safeDeclaredName =
		input.declaredName && isValidAgentName(input.declaredName) ? input.declaredName : undefined;
	if (safeSessionName && isClaimable(safeSessionName)) {
		return { name: safeSessionName, source: "user" };
	}
	if (safeSpawnName) {
		return {
			name: uniqueName(safeSpawnName, input),
			source: "spawn",
		};
	}
	if (safeDeclaredName) {
		if (isClaimable(safeDeclaredName)) {
			return { name: safeDeclaredName, source: "declared" };
		}
		return {
			name: uniqueName(safeDeclaredName, input),
			source: "generated",
		};
	}
	return {
		name: uniqueName(basename(input.cwd) || "agent", input),
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
