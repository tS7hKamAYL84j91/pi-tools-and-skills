/**
 * Pi Agents Registry Module
 *
 * Manages the in-memory AgentRecord for a single pi agent, with heartbeat
 * and disk persistence. Reads/reaps peer records from the shared registry.
 *
 * Pure functions extracted from the original Panopticon module and optimized for the
 * Registry interface (see types.ts).
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	unlinkSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { AgentNameSource, AgentRecord, AgentStatus } from "../../../lib/agent-registry.js";
import {
	REGISTRY_DIR,
	STALE_MS,
	isPidAlive,
	ensureRegistryDir,
	runAgentCleanup,
	reapOrphanedMailboxes,
} from "../../../lib/agent-registry.js";
import { assertPrivateFileTarget, ensurePrivateFileForRead, writeNewPrivateFileSync } from "../../../lib/private-local-mode.js";
import type { Registry as RegistryInterface } from "../types.js";
import {
	PANOPTICON_PARENT_ID_ENV,
	PANOPTICON_VISIBILITY_ENV,
	PANOPTICON_SPAWN_NAME_ENV,
} from "../../../lib/agent-registry.js";

// ── Constants ───────────────────────────────────────────────────

const HEARTBEAT_MS = 5_000;
const ORPHAN_REAP_MS = 60_000;

export const STATUS_SYMBOL: Record<AgentStatus, string> = {
	running: "R",
	waiting: "W",
	done: "D",
	blocked: "B",
	stalled: "S",
	terminated: "X",
	unknown: "?",
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
export function pickActiveName(input: PickActiveNameInput): { name: string; source: AgentNameSource } {
	if (input.sessionName) {
		return { name: input.sessionName, source: "user" };
	}
	if (input.spawnName) {
		return { name: pickName(input.cwd, input.records, input.selfId, input.spawnName), source: "spawn" };
	}
	return { name: pickName(input.cwd, input.records, input.selfId), source: "generated" };
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
 * Parse a single registry JSON file and classify it.
 * Returns the record if live/stalled, or null if dead/corrupt.
 * Side effect: deletes files for dead/corrupt records and fires cleanup hooks.
 */
function parseRegistryFile(fullPath: string, now: number): AgentRecord | null {
	try {
		ensurePrivateFileForRead(fullPath);
		const record: AgentRecord = JSON.parse(readFileSync(fullPath, "utf-8"));
		if (!record.name) {
			record.name = basename(record.cwd) || record.id.slice(0, 8);
		}
		const cls = classifyRecord(record, now, isPidAlive(record.pid));
		if (cls === "dead") {
			try { unlinkSync(fullPath); } catch { /* already gone */ }
			runAgentCleanup(record.id);
			return null;
		}
		if (cls === "stalled") record.status = "stalled";
		return record;
	} catch {
		/* Corrupt or unreadable — remove it */
		try { unlinkSync(fullPath); } catch { /* already gone */ }
		return null;
	}
}

// ── Registry class ──────────────────────────────────────────────

/**
 * Registry manages a single agent's record: in-memory copy, disk persistence,
 * and heartbeat. Provides methods to mutate and flush the record.
 */
export default class Registry implements RegistryInterface {
	readonly selfId: string;
	private record: AgentRecord | undefined;
	private lastSyncedSessionName: string | undefined;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private orphanReapTimer: ReturnType<typeof setInterval> | null = null;

	constructor(
		selfId: string,
		private readonly getSessionName?: () => string | undefined,
	) {
		this.selfId = selfId;
		this.record = undefined;
		this.lastSyncedSessionName = undefined;
	}

	getRecord(): Readonly<AgentRecord> | undefined {
		return this.record;
	}

	register(ctx: ExtensionContext): void {
		const cwd = process.cwd();

		// Read all existing records to pick a unique name.
		const records = this.readAllPeers();
		const spawnName = process.env[PANOPTICON_SPAWN_NAME_ENV];
		const sessionName = this.readSessionName();
		const { name, source } = pickActiveName({ cwd, records, selfId: this.selfId, sessionName, spawnName });
		this.lastSyncedSessionName = sessionName;

		const parentId = process.env[PANOPTICON_PARENT_ID_ENV];
		const visibility = process.env[PANOPTICON_VISIBILITY_ENV] === "scoped" ? "scoped" : "global";

		// Create the record
		this.record = {
			id: this.selfId,
			name,
			...(spawnName ? { spawn_name: spawnName } : {}),
			name_source: source,
			pid: process.pid,
			cwd,
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "",
			startedAt: Date.now(),
			heartbeat: Date.now(),
			status: "waiting" as const,
			...(parentId ? { parentId } : {}),
			visibility,
			sessionDir: ctx.sessionManager.getSessionDir(),
			sessionFile: ctx.sessionManager.getSessionFile(),
		};

		// Write to disk
		this.flush();

		// Start heartbeat
		this.heartbeatTimer = setInterval(() => {
			this.heartbeat();
		}, HEARTBEAT_MS);

		// Reap orphaned mailboxes on startup and periodically
		reapOrphanedMailboxes();
		this.orphanReapTimer = setInterval(() => {
			reapOrphanedMailboxes();
		}, ORPHAN_REAP_MS);
	}

	unregister(): void {
		// Stop timers
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
		if (this.orphanReapTimer) {
			clearInterval(this.orphanReapTimer);
			this.orphanReapTimer = null;
		}

		// Delete record file and this agent's Maildir storage. Dead-peer cleanup
		// happens through onAgentCleanup hooks; unregister owns current-agent cleanup
		// because messaging hooks are disposed before the registry record is removed.
		if (this.record) {
			try {
				unlinkSync(join(REGISTRY_DIR, `${this.record.id}.json`));
			} catch {
				// already gone
			}
			try {
				rmSync(join(REGISTRY_DIR, this.record.id), { recursive: true, force: true });
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

	setName(name: string, source?: AgentNameSource): void {
		if (this.record) {
			this.record.name = name;
			if (source) {
				this.record.name_source = source;
			}
			if (source === "programmatic" || source === "user") {
				this.lastSyncedSessionName = name;
			}
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
			const tmpPath = `${path}.${process.pid}.tmp`;
			assertPrivateFileTarget(tmpPath);
			// Heavily justified: called synchronously on agent shutdown to update status to terminated.
			writeNewPrivateFileSync(tmpPath, JSON.stringify(this.record, null, 2));
			assertPrivateFileTarget(path);
			renameSync(tmpPath, path);
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
			const files = readdirSync(REGISTRY_DIR).filter(
				(f) => typeof f === "string" && f.endsWith(".json"),
			);
			const records: AgentRecord[] = [];
			for (const file of files) {
				const rec = parseRegistryFile(join(REGISTRY_DIR, file), now);
				if (rec) records.push(rec);
			}
			return records;
		} catch {
			return [];
		}
	}

	// ── Internal: Heartbeat ──────────────────────────────────────

	private heartbeat(): void {
		if (!this.record) return;

		this.syncSessionName();

		this.record = buildRecord(
			this.record,
			this.record.status,
			this.record.task,
			Date.now(),
		);

		this.flush();
	}

	private readSessionName(): string | undefined {
		try {
			const sessionName = this.getSessionName?.()?.trim();
			return sessionName || undefined;
		} catch {
			return undefined;
		}
	}

	private syncSessionName(): void {
		if (!this.record) return;
		const sessionName = this.readSessionName();
		if (sessionName === this.lastSyncedSessionName) return;

		const records = this.readAllPeers();
		if (sessionName) {
			this.lastSyncedSessionName = sessionName;
			this.record.name = sessionName;
			this.record.name_source = "user";
			return;
		}

		this.lastSyncedSessionName = undefined;
		const { name, source } = pickActiveName({
			cwd: this.record.cwd,
			records,
			selfId: this.selfId,
			spawnName: this.record.spawn_name,
		});
		this.record.name = name;
		this.record.name_source = source;
	}
}
