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
import { rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type {
	AgentNameSource,
	AgentRecord,
	AgentStatus,
} from "../../../lib/agent-registry.js";
import {
	PANOPTICON_PARENT_ID_ENV,
	PANOPTICON_SPAWN_NAME_ENV,
	PANOPTICON_VISIBILITY_ENV,
	reapOrphanedMailboxes,
	REGISTRY_DIR,
} from "../../../lib/agent-registry.js";
import type { Registry as RegistryInterface } from "../types.js";
import { buildRecord, pickActiveName } from "./record-utils.js";
import { readPeerRecords } from "./daemon-registry-source.js";
import type { DaemonRegistryClient } from "../daemon-client/daemon-registry-client.js";
import { flushRecord } from "./registry-persistence.js";

export { classifyRecord } from "./registry-reader.js";

// ── Constants ───────────────────────────────────────────────────

const HEARTBEAT_MS = 5_000;
const ORPHAN_REAP_MS = 60_000;

// ── Registry class ──────────────────────────────────────────────

/**
 * Registry manages a single agent's record: in-memory copy, disk persistence,
 * and heartbeat. Provides methods to mutate and flush the record.
 */
export default class Registry implements RegistryInterface {
	readonly selfId: string;
	private record: AgentRecord | undefined;
	private externalPeers: AgentRecord[] = [];
	private daemonClient: DaemonRegistryClient | undefined;
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
		const { name, source } = pickActiveName({
			cwd,
			records,
			selfId: this.selfId,
			sessionName,
			spawnName,
		});
		this.lastSyncedSessionName = sessionName;

		const parentId = process.env[PANOPTICON_PARENT_ID_ENV];
		const visibility =
			process.env[PANOPTICON_VISIBILITY_ENV] === "scoped" ? "scoped" : "global";

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
				rmSync(join(REGISTRY_DIR, this.record.id), {
					recursive: true,
					force: true,
				});
			} catch {
				// already gone
			}
		}

		this.record = undefined;
	}
	isRootSession(): boolean {
		return !this.record?.parentId;
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

	setExternalPeers(records: AgentRecord[]): void {
		this.externalPeers = records.filter((record) => record.kind === "external");
	}

	/**
	 * Attach the daemon-registry client (M6 handoff). Called by the daemon-mode
	 * wiring before the client starts; the read path switches to the daemon
	 * snapshot for as long as the client is live.
	 */
	setDaemonClient(client: DaemonRegistryClient): void {
		this.daemonClient = client;
	}

	flush(): void {
		flushRecord(this.record);
	}

	/**
	 * Read all live/stalled peer records from the registry.
	 * Reaps dead agents (deletes their files + runs cleanup hooks).
	 */
	readAllPeers(): AgentRecord[] {
		// Exactly one registry authority per workspace state, chosen at session
		// start (design doc section 7, no dual-write): the daemon snapshot when
		// the daemon-mode wiring attached a client, the incumbent shared-disk
		// registry otherwise. The swap policy lives in daemon-registry-source.
		return readPeerRecords(this.externalPeers, this.daemonClient);
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
