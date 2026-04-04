/**
 * Pi Agents Registry Module
 *
 * Manages the in-memory AgentRecord for a single pi agent, with heartbeat
 * and disk persistence. Reads/reaps peer records from the shared registry.
 *
 * Pure functions extracted from pi-panopticon.ts and optimized for the
 * Registry interface (see types.ts).
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	readFileSync,
	readdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { AgentRecord, AgentStatus } from "../../lib/agent-registry.js";
import {
	REGISTRY_DIR,
	STALE_MS,
	isPidAlive,
	ensureRegistryDir,
	runAgentCleanup,
} from "../../lib/agent-registry.js";
import type { Registry as RegistryInterface } from "./types.js";

// ── Constants ───────────────────────────────────────────────────

const HEARTBEAT_MS = 5_000;

export const STATUS_SYMBOL: Record<AgentStatus, string> = {
	running: "🟢",
	waiting: "🟡",
	done: "✅",
	blocked: "🚧",
	stalled: "🛑",
	terminated: "⚫",
	unknown: "⚪",
};

// ── Pure functions (exported for tests) ─────────────────────────

/**
 * Classify an agent record's lifecycle state.
 * @internal exported for tests
 */
export function classifyRecord(
	record: AgentRecord,
	now: number,
	pidAlive: boolean,
): "live" | "stalled" | "dead" {
	if (now - record.heartbeat <= STALE_MS) return "live";
	return pidAlive ? "stalled" : "dead";
}

/**
 * Build a record with updated heartbeat, status, and task.
 * @internal exported for tests
 */
export function buildRecord(
	base: AgentRecord,
	status: AgentStatus,
	task: string | undefined,
): AgentRecord {
	return { ...base, heartbeat: Date.now(), status, task };
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
): string {
	const base = basename(cwd) || "agent";
	if (!nameTaken(base, records, selfId)) return base;
	for (let i = 2; i < 100; i++) {
		const candidate = `${base}-${i}`;
		if (!nameTaken(candidate, records, selfId)) return candidate;
	}
	return `${base}-${selfId.slice(0, 6)}`;
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

/**
 * Return cleanup paths for a dead agent (registry file).
 * Used by external cleanup logic.
 * @internal exported for tests
 */
export function agentCleanupPaths(id: string): string[] {
	return [
		join(REGISTRY_DIR, `${id}.json`),
	];
}

// ── Registry class ──────────────────────────────────────────────

/**
 * Registry manages a single agent's record: in-memory copy, disk persistence,
 * and heartbeat. Provides methods to mutate and flush the record.
 */
export default class Registry implements RegistryInterface {
	readonly selfId: string;
	private record: AgentRecord | undefined;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

	constructor(selfId: string) {
		this.selfId = selfId;
		this.record = undefined;
	}

	getRecord(): Readonly<AgentRecord> | undefined {
		return this.record;
	}

	register(ctx: ExtensionContext): void {
		const cwd = process.cwd();

		// Read all existing records to pick a unique name
		const records = this.readAllPeers();
		const name = pickName(cwd, records, this.selfId);

		// Create the record
		this.record = {
			id: this.selfId,
			name,
			pid: process.pid,
			cwd,
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "",
			startedAt: Date.now(),
			heartbeat: Date.now(),
			status: "waiting" as const,
			sessionDir: ctx.sessionManager.getSessionDir(),
			sessionFile: ctx.sessionManager.getSessionFile(),
		};

		// Write to disk
		this.flush();

		// Start heartbeat
		this.heartbeatTimer = setInterval(() => {
			this.heartbeat();
		}, HEARTBEAT_MS);
	}

	unregister(): void {
		// Stop heartbeat
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}

		// Delete record file
		if (this.record) {
			try {
				unlinkSync(join(REGISTRY_DIR, `${this.record.id}.json`));
			} catch {
				// already gone
			}
		}

		this.record = undefined;
	}

	setStatus(status: AgentStatus): void {
		if (this.record) {
			this.record.status = status;
			this.flush();
		}
	}

	updateModel(model: string): void {
		if (this.record) {
			this.record.model = model;
			this.flush();
		}
	}

	setTask(task: string): void {
		if (this.record) {
			this.record.task = task;
			this.flush();
		}
	}

	setName(name: string): void {
		if (this.record) {
			this.record.name = name;
			this.flush();
		}
	}

	updatePendingMessages(count: number): void {
		if (this.record) {
			this.record.pendingMessages = count;
			this.flush();
		}
	}

	flush(): void {
		if (!this.record) return;
		try {
			ensureRegistryDir();
			const path = join(REGISTRY_DIR, `${this.record.id}.json`);
			writeFileSync(path, JSON.stringify(this.record, null, 2), "utf-8");
		} catch {
			// best-effort
		}
	}

	/**
	 * Read all live/stalled peer records from the registry.
	 * Reaps dead agents (deletes their files + runs cleanup hooks).
	 */
	readAllPeers(): AgentRecord[] {
		try {
			ensureRegistryDir();
			const now = Date.now();
			return readdirSync(REGISTRY_DIR)
				.filter((f) => typeof f === "string" && f.endsWith(".json"))
				.flatMap((file) => {
					const fullPath = join(REGISTRY_DIR, file);
					try {
						const record: AgentRecord = JSON.parse(
							readFileSync(fullPath, "utf-8"),
						);
						if (!record.name) {
							record.name = basename(record.cwd) || record.id.slice(0, 8);
						}
						const cls = classifyRecord(record, now, isPidAlive(record.pid));
						if (cls === "dead") {
							// Reap dead agent
							try {
								unlinkSync(fullPath);
							} catch {
								// already gone
							}
							runAgentCleanup(record.id);
							return [];
						}
						// Mark stalled agents
						if (cls === "stalled") {
							record.status = "stalled";
						}
						return [record];
					} catch {
						// Corrupt or unreadable file; try to delete
						try {
							unlinkSync(fullPath);
						} catch {
							// already gone
						}
						return [];
					}
				});
		} catch {
			return [];
		}
	}

	// ── Internal: Heartbeat ──────────────────────────────────────

	private heartbeat(): void {
		if (!this.record) return;

		this.record = buildRecord(
			this.record,
			this.record.status,
			this.record.task,
		);

		this.flush();
	}
}
