/**
 * Shared agent registry types and utilities.
 *
 * Both pi-panopticon.ts and pi-messaging.ts use the same registry
 * directory (~/.pi/agents/) and the same record format. This module
 * provides the shared types and low-level IO functions so neither
 * extension duplicates the other.
 *
 * Does NOT contain: Maildir IO (see transports/maildir.ts).
 */

import {
	existsSync,
	mkdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Constants ───────────────────────────────────────────────────

export const REGISTRY_DIR = join(homedir(), ".pi", "agents");
export const STALE_MS = 30_000;

// ── Types ───────────────────────────────────────────────────────

export type AgentStatus = "running" | "waiting" | "done" | "blocked" | "stalled" | "terminated" | "unknown";

export interface AgentRecord {
	id: string;
	name: string;
	pid: number;
	cwd: string;
	model: string;
	startedAt: number;
	heartbeat: number;
	status: AgentStatus;
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
	return () => { cleanupHooks.delete(hook); };
}

/** Run all registered cleanup hooks for a dead agent. */
export function runAgentCleanup(agentId: string): void {
	for (const hook of cleanupHooks) {
		try { hook(agentId); } catch { /* best-effort */ }
	}
}

// ── Pure helpers ────────────────────────────────────────────────

export function isPidAlive(pid: number): boolean {
	try { process.kill(pid, 0); return true; } catch { return false; }
}

export function ensureRegistryDir(): void {
	if (!existsSync(REGISTRY_DIR)) mkdirSync(REGISTRY_DIR, { recursive: true });
}


