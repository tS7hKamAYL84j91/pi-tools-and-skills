/**
 * Pi Agents Registry Module
 *
 * Manages the in-memory AgentRecord for a single pi agent, with heartbeat
 * and disk persistence. Reads/reaps peer records from the shared registry.
 *
 * Pure functions extracted from the original Agent Hub module and optimized for the
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
	PANOPTICON_NAMESPACE_ENV,
	PANOPTICON_PARENT_ID_ENV,
	PANOPTICON_SPAWN_NAME_ENV,
	PANOPTICON_VISIBILITY_ENV,
	isValidAgentName,
	normalizeNamespace,
	reapOrphanedMailboxes,
	REGISTRY_DIR,
} from "../../../lib/agent-registry.js";
import type { Registry as RegistryInterface } from "../types.js";
import { readDeclaredName } from "./declared-name.js";
import {
	isReservedName,
	recordDeclaredOwnership,
	reservedNamesFor,
} from "./namespace-ownership.js";
import { buildRecord, nameTaken, pickActiveName } from "./record-utils.js";
import { readVolatileRegistryRecords } from "./registry-reader.js";
import { flushRecord } from "./registry-persistence.js";

export { classifyRecord } from "./registry-reader.js";

// ── Constants ───────────────────────────────────────────────────

const HEARTBEAT_MS = 5_000;
const ORPHAN_REAP_MS = 60_000;
/** Ownership-journal refresh cadence for declared leads. */
const OWNERSHIP_REFRESH_MS = 60_000;

// ── Registry class ──────────────────────────────────────────────

/**
 * Registry manages a single agent's record: in-memory copy, disk persistence,
 * and heartbeat. Provides methods to mutate and flush the record.
 */
export default class Registry implements RegistryInterface {
	readonly selfId: string;
	private record: AgentRecord | undefined;
	private externalPeers: AgentRecord[] = [];
	private lastSyncedSessionName: string | undefined;
	private declaredName: string | undefined;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private orphanReapTimer: ReturnType<typeof setInterval> | null = null;
	private ownershipWrite: Promise<void> = Promise.resolve();
	private lastOwnershipRefreshAt = 0;

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
		// Root agents adopt the project's declared panopticon name from trusted
		// launch metadata; spawned agents keep their spawn name (see pickActiveName).
		this.declaredName = spawnName ? undefined : readDeclaredName(cwd);
		// Reserved lead labels (durable ownership journal) are never claimable;
		// an agent may retake only its own declared label (restart takeover).
		const reservedNames = reservedNamesFor({
			selfId: this.selfId,
			takeoverName: this.declaredName,
		});
		const { name, source } = pickActiveName({
			cwd,
			records,
			selfId: this.selfId,
			sessionName,
			spawnName,
			declaredName: this.declaredName,
			reservedNames,
		});
		// A spawn name is a trusted launch label, not an entitlement: keep it as a
		// resolvable alias only when it is actually claimable. If it collided and the
		// active name was suffixed, or it names another owner's reserved lead, the raw
		// alias is dropped (the agent stays reachable by its active name) so a helper
		// can never advertise a lead's label as its alias.
		const storedSpawnName =
			spawnName && name === spawnName && !isReservedName(spawnName, reservedNames)
				? spawnName
				: undefined;
		this.lastSyncedSessionName = source === "user" ? sessionName : undefined;

		const parentId = process.env[PANOPTICON_PARENT_ID_ENV];
		const visibility =
			process.env[PANOPTICON_VISIBILITY_ENV] === "scoped" ? "scoped" : "global";
		// Namespace claims arrive from the trusted spawner env only; invalid
		// claims are dropped rather than trusted (defense in depth — namespaces
		// are routing/display metadata, never permission or filesystem paths).
		const namespace = normalizeNamespace(
			process.env[PANOPTICON_NAMESPACE_ENV],
		);

		// Create the record
		this.record = {
			id: this.selfId,
			name,
			...(storedSpawnName ? { spawn_name: storedSpawnName } : {}),
			name_source: source,
			pid: process.pid,
			cwd,
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "",
			startedAt: Date.now(),
			heartbeat: Date.now(),
			status: "waiting" as const,
			...(parentId ? { parentId } : {}),
			...(namespace
				? { namespace, namespace_source: "env" as const }
				: {}),
			visibility,
			sessionDir: ctx.sessionManager.getSessionDir(),
			sessionFile: ctx.sessionManager.getSessionFile(),
		};

		// Write to disk
		this.flush();

		// Journalled ownership for declared leads: the claim persists across
		// restarts so a renamed helper can never squat a reserved lead label.
		if (source === "declared" && this.declaredName === name) {
			this.refreshOwnership(Date.now());
		}

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

	/**
	 * Update agent name and flush. Refuses names already held by a different
	 * live agent or reserved in the durable ownership journal for another
	 * lead; returns false without mutating in those cases.
	 */
	setName(name: string, source?: AgentNameSource): boolean {
		if (!this.record) return false;
		// Unsafe names ("/", "#", …) are refused outright: they could equal
		// another agent's derived qualified or disambiguated display label.
		if (!isValidAgentName(name)) return false;
		if (!this.canClaimName(name)) return false;
		this.record.name = name;
		if (source) {
			this.record.name_source = source;
		}
		if (source === "programmatic" || source === "user") {
			this.lastSyncedSessionName = name;
		}
		this.flush();
		return true;
	}

	/** Return true when no different live agent holds this name and no other lead reserved it. */
	canClaimName(name: string): boolean {
		if (nameTaken(name, this.readAllPeers(), this.selfId)) return false;
		const reserved = reservedNamesFor({
			selfId: this.selfId,
			takeoverName: this.declaredName,
		});
		return !isReservedName(name, reserved);
	}

	/** Wait for the latest durable ownership write (tests/shutdown). */
	awaitOwnershipWrite(): Promise<void> {
		return this.ownershipWrite;
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

	flush(): void {
		flushRecord(this.record);
	}

	/**
	 * Read all live/stalled peer records from the registry.
	 * Reaps dead agents (deletes their files + runs cleanup hooks).
	 */
	readAllPeers(): AgentRecord[] {
		return [...this.externalPeers, ...readVolatileRegistryRecords()];
	}

	// ── Internal: Heartbeat ──────────────────────────────────────

	private heartbeat(): void {
		if (!this.record) return;

		this.syncSessionName();

		const now = Date.now();
		this.record = buildRecord(
			this.record,
			this.record.status,
			this.record.task,
			now,
		);

		this.flush();

		// Declared leads keep their durable ownership claim fresh.
		if (
			this.record.name_source === "declared" &&
			this.record.name === this.declaredName &&
			now - this.lastOwnershipRefreshAt >= OWNERSHIP_REFRESH_MS
		) {
			this.refreshOwnership(now);
		}
	}

	private refreshOwnership(now: number): void {
		const record = this.record;
		if (!record) return;
		this.lastOwnershipRefreshAt = now;
		this.ownershipWrite = recordDeclaredOwnership({
			name: record.name,
			ownerId: record.id,
			cwd: record.cwd,
			createdAt: now,
			lastSeenAt: now,
		}).catch(() => {
			// best-effort: claim is re-recorded on the next heartbeat
	});
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

		if (sessionName) {
			// Unsafe session names are never adopted as registry names (they
			// could collide with derived display labels); a claimable session
			// name is skipped while another live agent or lead reservation holds
			// it, and retried on a later heartbeat (self-healing, no duplicates).
			if (!isValidAgentName(sessionName)) return;
			if (!this.canClaimName(sessionName)) return;
			this.lastSyncedSessionName = sessionName;
			this.record.name = sessionName;
			this.record.name_source = "user";
			return;
		}

		this.lastSyncedSessionName = undefined;
		const reservedNames = reservedNamesFor({
			selfId: this.selfId,
			takeoverName: this.declaredName,
		});
		const { name, source } = pickActiveName({
			cwd: this.record.cwd,
			records: this.readAllPeers(),
			selfId: this.selfId,
			spawnName: this.record.spawn_name,
			declaredName: this.declaredName,
			reservedNames,
		});
		this.record.name = name;
		this.record.name_source = source;
	}
}
