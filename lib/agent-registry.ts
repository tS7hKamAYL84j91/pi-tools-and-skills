/**
 * Shared agent registry types and utilities.
 *
 * Both pi-panopticon.ts and pi-messaging.ts use the same registry
 * directory (~/.pi/agents/) and the same record format. This module
 * provides the shared types and low-level IO functions so neither
 * extension duplicates the other.
 *
 * Does NOT contain: Maildir IO (see transports/maildir.ts),
 * socket protocol (see pi-panopticon.ts).
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

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
	socket?: string;
	startedAt: number;
	heartbeat: number;
	status: AgentStatus;
	task?: string;
	pendingMessages?: number;
	sessionDir?: string;
	sessionFile?: string;
}

// ── Pure helpers ────────────────────────────────────────────────

export function isPidAlive(pid: number): boolean {
	try { process.kill(pid, 0); return true; } catch { return false; }
}

export function ensureRegistryDir(): void {
	if (!existsSync(REGISTRY_DIR)) mkdirSync(REGISTRY_DIR, { recursive: true });
}

export function readAllAgentRecords(): AgentRecord[] {
	try {
		const now = Date.now();
		return readdirSync(REGISTRY_DIR)
			.filter((f) => f.endsWith(".json"))
			.flatMap((file) => {
				try {
					const record = JSON.parse(readFileSync(join(REGISTRY_DIR, file), "utf-8")) as AgentRecord;
					if (!record.name) record.name = basename(record.cwd) || record.id.slice(0, 8);
					if (now - record.heartbeat > STALE_MS && !isPidAlive(record.pid)) return [];
					return [record];
				} catch { return []; }
			});
	} catch { return []; }
}

export function writeAgentRecord(record: AgentRecord): void {
	ensureRegistryDir();
	const path = join(REGISTRY_DIR, `${record.id}.json`);
	writeFileSync(path, JSON.stringify(record, null, 2), "utf-8");
}
