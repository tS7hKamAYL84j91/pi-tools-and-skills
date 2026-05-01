/**
 * Shared agent registry types and utilities.
 *
 * The panopticon extension modules (registry, messaging, health) and
 * the Maildir transport all depend on this shared module for the
 * registry directory path, record types, and cleanup utilities.
 *
 * Does NOT contain: Maildir IO (see transports/maildir.ts).
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Constants ───────────────────────────────────────────────────

export const REGISTRY_DIR = join(homedir(), ".pi", "agents");
export const STALE_MS = 30_000;

/** Env var read by spawned agents to learn their parent's registry id. */
export const PANOPTICON_PARENT_ID_ENV = "PI_PANOPTICON_PARENT_ID";
/** Env var read by spawned agents to mark themselves as scoped (vs global). */
export const PANOPTICON_VISIBILITY_ENV = "PI_PANOPTICON_VISIBILITY";
/** Env var read by spawned agents to use their requested spawn name in the registry. */
export const PANOPTICON_SPAWN_NAME_ENV = "PI_PANOPTICON_SPAWN_NAME";

// ── Types ───────────────────────────────────────────────────────

export type AgentStatus =
	| "running"
	| "waiting"
	| "done"
	| "blocked"
	| "stalled"
	| "terminated"
	| "unknown";

export type AgentVisibility = "global" | "scoped";

export interface AgentRecord {
	id: string;
	name: string;
	pid: number;
	cwd: string;
	model: string;
	startedAt: number;
	heartbeat: number;
	status: AgentStatus;
	/** Parent agent id for spawned/scoped agents. Manual agents omit this. */
	parentId?: string;
	/** Visibility mode: global agents see all; scoped agents see parent, siblings, and children. */
	visibility?: AgentVisibility;
	task?: string;
	pendingMessages?: number;
	sessionDir?: string;
	sessionFile?: string;
}

// ── Dead-agent cleanup hooks ────────────────────────────────────

type CleanupHook = (agentId: string) => void;
const cleanupHooks = new Set<CleanupHook>();

/** Register a callback invoked when a dead agent is reaped. Returns a dispose function. */
export function onAgentCleanup(hook: CleanupHook): () => void {
	cleanupHooks.add(hook);
	return () => {
		cleanupHooks.delete(hook);
	};
}

/** Run all registered cleanup hooks for a dead agent. */
export function runAgentCleanup(agentId: string): void {
	for (const hook of cleanupHooks) {
		try {
			hook(agentId);
		} catch {
			/* best-effort */
		}
	}
}

// ── Pure helpers ────────────────────────────────────────────────

export function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function ensureRegistryDir(): void {
	if (!existsSync(REGISTRY_DIR)) mkdirSync(REGISTRY_DIR, { recursive: true });
}

/**
 * Reap orphaned mailbox directories and stale files in the agents dir.
 *
 * Scans ~/.pi/agents/ for:
 * - Directories whose PID is no longer alive and have no matching .json registry file
 * - Stale .sock files whose PID is no longer alive
 *
 * This catches leftovers that normal dead-agent reaping misses:
 * - Directories from old sessions (same PID, different session ID)
 * - Empty dirs left when only the inbox was cleaned
 * - .sock files from crashed agents
 *
 * Safe to call periodically (e.g. on startup + every 60s).
 */
export function reapOrphanedMailboxes(): { removed: number } {
	try {
		ensureRegistryDir();
	} catch {
		return { removed: 0 };
	}

	let removed = 0;
	let entries: string[];
	try {
		entries = readdirSync(REGISTRY_DIR);
	} catch {
		return { removed: 0 };
	}

	// Build set of IDs that have a live .json registry file
	const registeredIds = new Set(
		entries.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)),
	);

	for (const entry of entries) {
		const fullPath = join(REGISTRY_DIR, entry);

		// Skip .json files — handled by normal readAllPeers reaping
		if (entry.endsWith(".json")) continue;

		// Extract PID from "{pid}-{sessionId}" or "{pid}-{sessionId}.sock"
		const baseName = entry.replace(/\.sock$/, "");
		const dashIdx = baseName.indexOf("-");
		if (dashIdx < 1) continue; // doesn't match expected format

		const pid = Number.parseInt(baseName.slice(0, dashIdx), 10);
		if (Number.isNaN(pid)) continue;

		// Skip if PID is alive — could be an active agent
		if (isPidAlive(pid)) continue;

		// Skip directories that still have a registry .json (will be reaped normally)
		if (!entry.endsWith(".sock") && registeredIds.has(entry)) continue;

		// Dead PID, no registry file → orphaned, safe to remove
		try {
			if (entry.endsWith(".sock")) {
				unlinkSync(fullPath);
			} else {
				runAgentCleanup(entry);
				rmSync(fullPath, { recursive: true, force: true });
			}
			removed++;
		} catch {
			/* best-effort */
		}
	}

	return { removed };
}
