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
import { ensurePrivateDirectory } from "./private-local-mode.js";

// ── Constants ───────────────────────────────────────────────────

export const REGISTRY_DIR = join(homedir(), ".pi", "agents");
export const STALE_MS = 30_000;

/** Env var read by spawned agents to learn their parent's registry id. */
export const PANOPTICON_PARENT_ID_ENV = "PI_PANOPTICON_PARENT_ID";
/** Env var read by spawned agents to mark themselves as scoped (vs global). */
export const PANOPTICON_VISIBILITY_ENV = "PI_PANOPTICON_VISIBILITY";
/** Env var read by spawned agents to use their requested spawn name in the registry. */
export const PANOPTICON_SPAWN_NAME_ENV = "PI_PANOPTICON_SPAWN_NAME";
/** Env var carrying the canonical parent-namespace anchor for a supporting agent. */
export const PANOPTICON_NAMESPACE_ENV = "PI_PANOPTICON_NAMESPACE";

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

export type AgentNameSource =
	| "spawn"
	| "user"
	| "programmatic"
	| "generated"
	| "declared";

export type AgentKind = "pi" | "external";

export interface AgentRecord {
	id: string;
	name: string;
	/** Immutable requested spawn name, when this agent was created by spawn_agent. */
	spawn_name?: string;
	/** Source of the active registry/display name. */
	name_source?: AgentNameSource;
	/**
	 * Declared canonical lead name from trusted project launch metadata
	 * (automationsProfile.panopticonName). Stable across resume even when a
	 * pre-existing session name is the active display label; used for the
	 * durable ownership claim and as the child namespace anchor.
	 */
	declared_name?: string;
	/** Agent kind: pi (default) or external non-pi peer. */
	kind?: AgentKind;
	pid: number;
	cwd: string;
	model: string;
	startedAt: number;
	heartbeat: number;
	status: AgentStatus;
	/** Parent agent id for spawned/scoped agents. Manual agents omit this. */
	parentId?: string;
	/**
	 * Canonical parent-namespace anchor for supporting agents (the owning
	 * lead's canonical label, e.g. "eo-agent-comms-gm"). Root/lead and legacy
	 * agents omit this. A namespace label is display/routing metadata only —
	 * it never grants permissions and is never used raw in filesystem paths.
	 */
	namespace?: string;
	/** Where the namespace claim came from. Currently only inherited spawn env. */
	namespace_source?: "env";
	/** Visibility mode: global agents see all; scoped agents see parent, siblings, and children. */
	visibility?: AgentVisibility;
	task?: string;
	pendingMessages?: number;
	sessionDir?: string;
	sessionFile?: string;
	/** Durable mailbox path for external agents (kind === 'external'). */
	mailboxPath?: string;
}

// ── Namespace validation ───────────────────────────────────────

/**
 * Namespace anchors are lowercase labels derived from canonical agent names.
 * Path separators, traversal segments, uppercase, and edge punctuation are
 * rejected so a namespace can never smuggle a filesystem path or a lookalike
 * of another anchor. Namespaces are still never interpolated into paths;
 * this charset is defense in depth.
 */
const NAMESPACE_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

/**
 * Registry-name charset shared by set_name, declared metadata, session sync,
 * and registry-file parsing. Excludes "/" and "#" so a plain record name can
 * never equal another agent's qualified namespace label ("lead/child") or a
 * duplicate-disambiguation suffix ("name#id6") — those forms are derived,
 * never claimable.
 */
export const SAFE_AGENT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** True when `name` is a safe registry name (charset above, trimmed non-empty). */
export function isValidAgentName(name: string): boolean {
	const trimmed = name?.trim();
	return !!trimmed && SAFE_AGENT_NAME.test(trimmed);
}

/**
 * Normalise a raw namespace claim to a safe anchor, or undefined when the
 * claim is invalid and must be ignored. Lowercases, trims, and rejects
 * traversal-shaped values ("..", any "/" or "\\", empty, >64 chars).
 */
export function normalizeNamespace(raw: string | undefined): string | undefined {
	const trimmed = raw?.trim().toLowerCase();
	if (!trimmed || trimmed.length > 64) return undefined;
	if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
		return undefined;
	}
	return NAMESPACE_PATTERN.test(trimmed) ? trimmed : undefined;
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
	if (!existsSync(REGISTRY_DIR)) mkdirSync(REGISTRY_DIR, { recursive: true, mode: 0o700 });
	ensurePrivateDirectory(REGISTRY_DIR);
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
