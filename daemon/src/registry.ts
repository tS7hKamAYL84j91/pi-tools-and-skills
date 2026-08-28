/**
 * DaemonRegistry (T-870 slice 1): the daemon-owned agent registry.
 *
 * - M3 one-live-binding (ADR-0018 M3): one live binding per agent_id at a
 *   time. The latest authenticated admission wins; the loser's instance is
 *   invalidated with an audited notice and an abort hook (in-flight turns are
 *   aborted by the serve layer via the notify callback). Bindings are keyed
 *   by agent_id, one slot each — fan-out to one identity does not exist.
 * - M2 supervision (design doc section 5): a crashed instance is re-admitted
 *   ONLY as a new generation after bounded respawn backoff (1s doubling to a
 *   60s cap, reset after a stable lifetime) — never silently respawned in
 *   place; `drainForClose` gives in-flight agents a bounded grace (10s), then
 *   aborts the remainder.
 * - M6 groundwork (design doc section 7): monotonically sequenced change
 *   events plus an atomic snapshot taken under the registry lock. The client
 *   overlap rules (buffer until the snapshot is applied, drop events with
 *   seq <= the snapshot's seq, resync only on a true gap) are implemented by
 *   RegistryEventBuffer; the socket client integration is slice 2.
 * - Durability: identity records are signed and fsync-ordered via identity.ts
 *   (generation-N durable before any binding publish, section 3); recovery
 *   rebuilds identities with generation continuity and invalidates stale
 *   live-instance records (ADR sections 2/7); a tampered record is
 *   quarantined, never trusted and never silently dropped.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
	admitInstance,
	type InstanceCapability,
	type LiveBinding,
} from "./admission.js";
import { appendAudit } from "./audit.js";
import {
	createIdentity,
	invalidateLiveInstance,
	loadIdentity,
	type AdmissionScope,
	type IdentityRecord,
} from "./identity.js";
import { assertSafeId, identitiesDir, type DaemonRoots } from "./paths.js";
import { quarantineRecord } from "./record.js";
import type { AuditSink } from "./keys.js";

/** Bounded respawn backoff (M2): 1s doubling to a 60s cap, reset on stability. */
export const RESPAWN_BACKOFF_BASE_MS = 1_000;
export const RESPAWN_BACKOFF_CAP_MS = 60_000;
/** Instance lifetime that counts as stable and resets the backoff ladder (M2). */
export const STABILITY_WINDOW_MS = 60_000;
/** pi close drain grace before remaining mid-turn agents are aborted (M2). */
export const CLOSE_DRAIN_GRACE_MS = 10_000;

const EVENT_LOG_CAP = 1_024;
const CLIENT_BUFFER_CAP = 1_024;

/** Spawn request: display alias plus the ADR-0008 (5a)/(7) guard-input tags. */
export interface SpawnRequest {
	readonly displayName: string;
	/** Parent agent_id, or null for a root admission. */
	readonly parentId: string | null;
	/** Visibility tag migrated from Panopticon spawn metadata; daemon-owned after. */
	readonly visibility: string;
	readonly scope: AdmissionScope;
}

/** Registry-derived guard inputs for the ADR-0008 delivery seam (design doc section 5a). */
export interface RegistryGuardInputs {
	readonly parentId: string | null;
	readonly visibility: string;
	readonly scope: AdmissionScope;
}

export type RegistryEventKind =
	| "identity_created"
	| "instance_admitted"
	| "instance_invalidated";

export type InvalidationReason =
	| "superseded"
	| "crashed"
	| "restart_stale"
	| "close_drain_expired";

export interface RegistryEvent {
	readonly seq: number;
	readonly at: string;
	readonly kind: RegistryEventKind;
	readonly agentId: string;
	readonly instanceId?: string;
	readonly generation?: number;
	readonly reason?: InvalidationReason;
}

export interface RegistryEntry {
	readonly agentId: string;
	readonly displayName: string;
	readonly generation: number;
	readonly liveInstanceId?: string;
	readonly parentId: string | null;
	readonly visibility: string;
	readonly scope: AdmissionScope;
}

export interface RegistrySnapshot {
	/** Sequence of the last event contained in this snapshot. */
	readonly seq: number;
	readonly generatedAt: string;
	readonly entries: RegistryEntry[];
}

export interface AdmittedBinding {
	/** Discriminator: admission succeeded. */
	readonly admitted: true;
	readonly agentId: string;
	readonly instanceId: string;
	readonly generation: number;
	/** Daemon-issued capability secret; the caller delivers it out-of-band. */
	readonly capabilitySecret: string;
	/** The M3 loser, when this admission displaced a live binding. */
	readonly superseded?: {
		readonly instanceId: string;
		readonly generation: number;
	};
}

export interface AdmissionRejected {
	readonly admitted: false;
	readonly reason: "respawn_backoff";
	readonly retryAfterMs: number;
}

export interface InvalidationNotice {
	readonly agentId: string;
	readonly instanceId: string;
	readonly generation: number;
	readonly reason: InvalidationReason;
}

export interface CloseDrainResult {
	/** Agents whose binding disappeared during the grace (clean exit). */
	readonly drained: string[];
	/** Still-live mid-turn agents aborted at the grace deadline. */
	readonly aborted: string[];
}

export interface DaemonRegistryOptions {
	/** Audit sink; defaults to the daemon audit log. */
	readonly audit?: AuditSink;
	/**
	 * Visible-notice hook for invalidations (M3/M2): the serve layer uses it
	 * to notify the losing connection and abort its in-flight turns.
	 */
	readonly notify?: (notice: InvalidationNotice) => void;
	/** Injectable clock (backoff and drain timing in tests). */
	readonly now?: () => Date;
}

export interface RegistryKeys {
	readonly keyId: string;
	readonly privateKeyPem: string;
	readonly publicKeyPem: string;
}

interface LiveBindingState {
	readonly binding: LiveBinding;
	readonly capability: InstanceCapability;
	readonly admittedAtMs: number;
}

interface CrashTracking {
	consecutiveCrashes: number;
	respawnNotBeforeMs: number;
}

/** Backoff for the Nth consecutive unstable crash: 1s, 2s, ... capped at 60s (M2). */
export function respawnBackoffMs(consecutiveCrashes: number): number {
	return Math.min(
		RESPAWN_BACKOFF_BASE_MS * 2 ** (consecutiveCrashes - 1),
		RESPAWN_BACKOFF_CAP_MS,
	);
}

export class DaemonRegistry {
	private readonly identities = new Map<string, IdentityRecord>();
	private readonly bindings = new Map<string, LiveBindingState>();
	private readonly crashTracking = new Map<string, CrashTracking>();
	private readonly events: RegistryEvent[] = [];
	private readonly listeners = new Set<(event: RegistryEvent) => void>();
	private readonly verificationKeys: ReadonlyMap<string, string>;
	private seq = 0;
	private mutex: Promise<unknown> = Promise.resolve();
	private readonly auditSink: AuditSink;
	private readonly now: () => Date;

	readonly counters = {
		registered: 0,
		admitted: 0,
		superseded: 0,
		crashed: 0,
		rejectedBackoff: 0,
		disconnected: 0,
		drainedClean: 0,
		drainedAborted: 0,
	};

	constructor(
		private readonly roots: DaemonRoots,
		private readonly keys: RegistryKeys,
		options: DaemonRegistryOptions = {},
	) {
		this.auditSink = options.audit ?? ((event) => appendAudit(roots, event));
		this.now = options.now ?? ((): Date => new Date());
		this.verificationKeys = new Map([[keys.keyId, keys.publicKeyPem]]);
		this.notify = options.notify;
	}

	private readonly notify?: (notice: InvalidationNotice) => void;

	/**
	 * Recovery (ADR section 7): rebuild identity records with generation
	 * continuity, invalidate stale live-instance records (a restart never
	 * trusts a stale binding), and quarantine any record that fails
	 * integrity or schema validation. Replaying recovery is a no-op.
	 */
	static async recover(
		roots: DaemonRoots,
		keys: RegistryKeys,
		options: DaemonRegistryOptions = {},
	): Promise<DaemonRegistry> {
		const registry = new DaemonRegistry(roots, keys, options);
		let loaded = 0;
		let staleInvalidated = 0;
		let entries: string[] = [];
		try {
			entries = await readdir(identitiesDir(roots));
		} catch {
			// Fresh state root: nothing to recover.
		}
		for (const entry of entries) {
			if (!entry.endsWith(".json")) continue;
			const agentId = entry.slice(0, -5);
			const path = join(identitiesDir(roots), entry);
			try {
				// Daemon-minted ids pass; a planted hostile filename fails closed.
				assertSafeId("agent id", agentId);
				const identity = await loadIdentity(
					roots,
					agentId,
					registry.verificationKeys,
				);
				if (!identity) continue; // ENOENT, or parse/schema failure already quarantined + audited by the strict reader
				registry.identities.set(agentId, identity);
				loaded++;
				if (identity.liveInstanceId !== undefined) {
					registry.identities.set(
						agentId,
						await invalidateLiveInstance(roots, keys, identity),
					);
					registry.emit({
						kind: "instance_invalidated",
						agentId,
						instanceId: identity.liveInstanceId,
						generation: identity.generation,
						reason: "restart_stale",
					});
					staleInvalidated++;
				}
			} catch (error) {
				// Tampered/unknown-key record: quarantine the raw file — never
				// trusted, never silently dropped (ADR section 7).
				await quarantineRecord(roots, path, (error as Error).message);
			}
		}
		await registry.auditSink({
			kind: "registry_recovered",
			identities: loaded,
			staleBindingsInvalidated: staleInvalidated,
		});
		return registry;
	}

	/**
	 * Mint a stable agent_id for a spawn (or a Panopticon migration record):
	 * names are mutable aliases, so name reuse never rebinds a predecessor
	 * identity (ADR section 5) — every call creates a fresh identity.
	 */
	async registerAgent(request: SpawnRequest): Promise<IdentityRecord> {
		const displayName = request.displayName.trim();
		if (displayName.length === 0 || displayName.length > 128)
			throw new Error("display name must be 1..128 characters");
		if (request.visibility.length === 0 || request.visibility.length > 64)
			throw new Error("visibility must be 1..64 characters");
		if (request.parentId !== null)
			assertSafeId("parent agent id", request.parentId);
		return this.locked(async () => {
			const identity = await createIdentity(this.roots, this.keys, request);
			this.identities.set(identity.agentId, identity);
			this.counters.registered++;
			this.emit({
				kind: "identity_created",
				agentId: identity.agentId,
				generation: identity.generation,
			});
			await this.auditSink({
				kind: "identity_registered",
				agentId: identity.agentId,
				displayName,
				scope: request.scope,
			});
			return identity;
		});
	}

	/**
	 * Admit one instance of an existing agent (M3): the durable generation
	 * bump happens first (identity.ts fsync ordering), then the live binding
	 * is published. A pre-existing live binding is invalidated with an
	 * audited notice and an abort hook — one live binding per agent_id, ever.
	 */
	async admit(agentId: string): Promise<AdmittedBinding | AdmissionRejected> {
		assertSafeId("agent id", agentId);
		return this.locked(async () => {
			const identity = this.identities.get(agentId);
			if (!identity)
				throw new Error(
					`unknown agent id: ${agentId} (register before admitting)`,
				);
			const nowMs = this.now().getTime();
			const tracking = this.crashTracking.get(agentId);
			if (tracking && tracking.respawnNotBeforeMs > nowMs) {
				const retryAfterMs = tracking.respawnNotBeforeMs - nowMs;
				this.counters.rejectedBackoff++;
				await this.auditSink({
					kind: "admission_rejected",
					agentId,
					reason: "respawn_backoff",
					retryAfterMs,
				});
				return { admitted: false, reason: "respawn_backoff", retryAfterMs };
			}
			const previous = this.bindings.get(agentId);
			const { binding, capability, record } = await admitInstance(
				this.roots,
				this.keys,
				identity,
			);
			if (previous) {
				await this.dropBinding(previous, "superseded");
				this.counters.superseded++;
			}
			this.identities.set(agentId, record);
			this.bindings.set(agentId, { binding, capability, admittedAtMs: nowMs });
			this.counters.admitted++;
			this.emit({
				kind: "instance_admitted",
				agentId,
				instanceId: binding.instanceId,
				generation: binding.generation,
			});
			return {
				admitted: true,
				agentId,
				instanceId: binding.instanceId,
				generation: binding.generation,
				capabilitySecret: capability.capabilitySecret,
				...(previous
					? {
							superseded: {
								instanceId: previous.binding.instanceId,
								generation: previous.binding.generation,
							},
						}
					: {}),
			};
		});
	}

	/**
	 * M2 crash handling: the crashed instance's binding is invalidated (a
	 * re-admission later is a NEW generation), the respawn backoff ladder is
	 * armed (reset when the instance was stable), and the durable record's
	 * stale live-instance pointer is cleared. A crash notice for an already
	 * superseded instance is a no-op.
	 */
	async noteInstanceCrash(
		agentId: string,
		instanceId: string,
		crashedAt: Date = this.now(),
	): Promise<{
		recorded: boolean;
		backoffMs?: number;
		respawnNotBeforeMs?: number;
	}> {
		assertSafeId("agent id", agentId);
		return this.locked(async () => {
			const current = this.bindings.get(agentId);
			if (!current || current.binding.instanceId !== instanceId)
				return { recorded: false };
			const prior = this.crashTracking.get(agentId);
			const crashedAtMs = crashedAt.getTime();
			const lifetimeMs = crashedAtMs - current.admittedAtMs;
			// Reset on stability: an instance that lived past the stability window
			// starts the ladder over; only rapid crash loops escalate.
			const consecutiveCrashes =
				lifetimeMs >= STABILITY_WINDOW_MS
					? 1
					: (prior?.consecutiveCrashes ?? 0) + 1;
			const backoffMs = respawnBackoffMs(consecutiveCrashes);
			const respawnNotBeforeMs = crashedAtMs + backoffMs;
			const record = this.identities.get(agentId);
			if (record) {
				// Best-effort durable clear: liveness is corrected regardless, and
				// a failed write is surfaced rather than silent.
				await invalidateLiveInstance(this.roots, this.keys, record).catch(
					(error: unknown) =>
						this.auditSink({
							kind: "instance_crash_invalidations_failed",
							agentId,
							reason: (error as Error).message,
						}),
				);
			}
			this.bindings.delete(agentId);
			this.crashTracking.set(agentId, {
				consecutiveCrashes,
				respawnNotBeforeMs,
			});
			this.counters.crashed++;
			this.emit({
				kind: "instance_invalidated",
				agentId,
				instanceId,
				generation: current.binding.generation,
				reason: "crashed",
			});
			await this.auditSink({
				kind: "instance_crashed",
				agentId,
				instanceId,
				generation: current.binding.generation,
				lifetimeMs,
				consecutiveCrashes,
				nextBackoffMs: backoffMs,
			});
			return { recorded: true, backoffMs, respawnNotBeforeMs };
		});
	}

	/**
	 * Clean disconnect (no crash): release the binding without arming the
	 * respawn backoff. A stale instanceId is a no-op.
	 */
	async unbind(agentId: string, instanceId: string): Promise<boolean> {
		assertSafeId("agent id", agentId);
		return this.locked(async () => {
			const current = this.bindings.get(agentId);
			if (!current || current.binding.instanceId !== instanceId) return false;
			const record = this.identities.get(agentId);
			if (record) {
				await invalidateLiveInstance(this.roots, this.keys, record).catch(
					(error: unknown) =>
						this.auditSink({
							kind: "instance_disconnect_invalidations_failed",
							agentId,
							reason: (error as Error).message,
						}),
				);
			}
			this.bindings.delete(agentId);
			this.counters.disconnected++;
			this.emit({
				kind: "instance_invalidated",
				agentId,
				instanceId,
				generation: current.binding.generation,
				reason: undefined,
			});
			return true;
		});
	}

	/** Live binding for an agent, from daemon-owned state only. */
	bindingFor(agentId: string): LiveBinding | undefined {
		return this.bindings.get(agentId)?.binding;
	}

	/** Capability of the live binding (serve-loop ack verification). */
	capabilityFor(agentId: string): InstanceCapability | undefined {
		return this.bindings.get(agentId)?.capability;
	}

	/** Registry-derived ADR-0008 guard inputs for the delivery seam (design doc section 5a). */
	guardInputsFor(agentId: string): RegistryGuardInputs | undefined {
		const identity = this.identities.get(agentId);
		if (!identity) return undefined;
		return {
			parentId: identity.parentId ?? null,
			visibility: identity.visibility ?? "workspace",
			// Fail-closed default: a task-scoped binding is never a delivery target.
			scope: identity.scope ?? "task",
		};
	}

	/**
	 * M6 snapshot: a single-lock atomic read of the registry state — never a
	 * scan that events can interleave with. The snapshot's seq is the last
	 * event seq it contains; clients drop events with seq <= this value.
	 */
	async snapshot(): Promise<RegistrySnapshot> {
		return this.locked(() => ({
			seq: this.seq,
			generatedAt: new Date().toISOString(),
			entries: [...this.identities.keys()].map((agentId) =>
				this.entryFor(agentId),
			),
		}));
	}

	/**
	 * Subscribe to change events: the snapshot and the listener registration
	 * happen under the same lock, so no event is missed or duplicated between
	 * the two (the M6 sync protocol's overlap-free handshake).
	 */
	async subscribe(
		listener: (event: RegistryEvent) => void,
	): Promise<{ snapshot: RegistrySnapshot; unsubscribe: () => void }> {
		return this.locked(() => {
			this.listeners.add(listener);
			return {
				snapshot: {
					seq: this.seq,
					generatedAt: new Date().toISOString(),
					entries: [...this.identities.keys()].map((agentId) =>
						this.entryFor(agentId),
					),
				},
				unsubscribe: () => {
					this.listeners.delete(listener);
				},
			};
		});
	}

	/**
	 * M2 pi-close drain: in-flight agents get a bounded grace to finish; at
	 * the deadline the still-live captured instances are aborted (notified +
	 * invalidated). Clean exits during the grace are spared, and instances
	 * admitted during the grace are not captured (they have no in-flight turn).
	 */
	async drainForClose(
		graceMs: number = CLOSE_DRAIN_GRACE_MS,
	): Promise<CloseDrainResult> {
		const captured = new Map<string, string>();
		await this.locked(() => {
			for (const [agentId, state] of this.bindings)
				captured.set(agentId, state.binding.instanceId);
		});
		await sleep(graceMs);
		return this.locked(async () => {
			const drained: string[] = [];
			const aborted: string[] = [];
			for (const [agentId, instanceId] of captured) {
				const current = this.bindings.get(agentId);
				if (!current || current.binding.instanceId !== instanceId) {
					drained.push(agentId);
					this.counters.drainedClean++;
					continue;
				}
				await this.dropBinding(current, "close_drain_expired");
				aborted.push(agentId);
				this.counters.drainedAborted++;
			}
			return { drained, aborted };
		});
	}

	/** Read-only event log (bounded); the sync-protocol surface is snapshot+subscribe. */
	eventLog(): readonly RegistryEvent[] {
		return this.events;
	}

	private async dropBinding(
		state: LiveBindingState,
		reason: InvalidationReason,
	): Promise<void> {
		this.bindings.delete(state.binding.agentId);
		const event = this.emit({
			kind: "instance_invalidated",
			agentId: state.binding.agentId,
			instanceId: state.binding.instanceId,
			generation: state.binding.generation,
			reason,
		});
		// Durable audit: every invalidation is accountable (the M3 notice leg).
		await this.auditSink({
			kind: "instance_invalidated",
			agentId: event.agentId,
			instanceId: event.instanceId,
			generation: event.generation,
			reason,
		});
		// Visible notice + in-flight-turn abort hook; a faulty consumer must not
		// break the registry's own state transition.
		try {
			this.notify?.({
				agentId: state.binding.agentId,
				instanceId: state.binding.instanceId,
				generation: state.binding.generation,
				reason,
			});
		} catch {
			// Consumer isolation: the invalidation stands regardless.
		}
	}

	private entryFor(agentId: string): RegistryEntry {
		const identity = this.identities.get(agentId);
		if (!identity)
			throw new Error(
				`registry invariant violated: no identity for ${agentId}`,
			);
		const live = this.bindings.get(agentId);
		return {
			agentId,
			displayName: identity.displayName,
			generation: live?.binding.generation ?? identity.generation,
			...(live ? { liveInstanceId: live.binding.instanceId } : {}),
			parentId: identity.parentId ?? null,
			visibility: identity.visibility ?? "workspace",
			scope: identity.scope ?? "task",
		};
	}

	private emit(event: Omit<RegistryEvent, "seq" | "at">): RegistryEvent {
		this.seq += 1;
		const sequenced: RegistryEvent = {
			...event,
			seq: this.seq,
			at: new Date().toISOString(),
		};
		this.events.push(sequenced);
		if (this.events.length > EVENT_LOG_CAP)
			this.events.splice(0, this.events.length - EVENT_LOG_CAP);
		for (const listener of this.listeners) {
			try {
				listener(sequenced);
			} catch {
				// Consumer isolation: one broken listener cannot stall the log.
			}
		}
		return sequenced;
	}

	/** Registry lock: mutations, snapshots, and subscriptions serialize here. */
	private locked<T>(operation: () => Promise<T> | T): Promise<T> {
		const run = this.mutex.then(operation);
		this.mutex = run.catch(() => {});
		return run;
	}
}

/**
 * M6 client overlap rules (design doc section 7, formal review F7), as a
 * pure reusable piece for the slice-2 socket client: buffer events until the
 * snapshot is applied, drop events with seq <= the snapshot's seq, apply
 * thereafter in order, and resync (fresh snapshot) only on a true gap.
 */
export class RegistryEventBuffer {
	private snapshotSeq?: number;
	private expectedSeq?: number;
	private readonly buffered: RegistryEvent[] = [];
	private readonly appliedEvents: RegistryEvent[] = [];
	private resyncNeeded = false;

	/** Events received before the snapshot: buffered, then reconciled on apply. */
	applyEvent(
		event: RegistryEvent,
	): "applied" | "buffered" | "dropped" | "resync" {
		if (this.snapshotSeq === undefined) {
			if (this.buffered.length >= CLIENT_BUFFER_CAP) {
				// Unbounded pre-snapshot buffering would be a DoS; overflow demands resync.
				this.resyncNeeded = true;
				return "resync";
			}
			this.buffered.push(event);
			return "buffered";
		}
		if (event.seq <= this.snapshotSeq) return "dropped";
		// SAFETY: snapshotSeq was set in applySnapshot, which also assigned
		// expectedSeq; both move together and are never cleared.
		const expectedSeq = this.expectedSeq as number;
		if (event.seq === expectedSeq) {
			this.appliedEvents.push(event);
			this.expectedSeq = event.seq + 1;
			this.drainBuffered();
			return "applied";
		}
		if (event.seq > expectedSeq) {
			// True gap (seq > last applied + 1): resync with a fresh snapshot.
			this.resyncNeeded = true;
			return "resync";
		}
		return "dropped"; // duplicate or already-applied event
	}

	/** Apply the snapshot: contained events are dropped, later ones applied in order. */
	applySnapshot(snapshot: RegistrySnapshot): {
		dropped: number;
		applied: number;
	} {
		this.snapshotSeq = snapshot.seq;
		this.expectedSeq = snapshot.seq + 1;
		this.resyncNeeded = false;
		let dropped = 0;
		const pending = [...this.buffered];
		this.buffered.length = 0;
		for (const event of pending) {
			if (event.seq <= snapshot.seq) {
				dropped++;
				continue;
			}
			if (event.seq === this.expectedSeq) {
				this.appliedEvents.push(event);
				this.expectedSeq = event.seq + 1;
				continue;
			}
			// A buffered event beyond the next expected seq is a gap: resync.
			this.resyncNeeded = true;
		}
		return { dropped, applied: this.appliedEvents.length };
	}

	get resyncRequired(): boolean {
		return this.resyncNeeded;
	}

	get applied(): readonly RegistryEvent[] {
		return this.appliedEvents;
	}

	private drainBuffered(): void {
		// SAFETY: drainBuffered only runs after applySnapshot assigned expectedSeq;
		// applyEvent calls it on the applied path, where expectedSeq is a number.
		const expectedSeq = this.expectedSeq as number;
		for (let index = 0; index < this.buffered.length; ) {
			const event = this.buffered[index] as RegistryEvent;
			if (event.seq === expectedSeq) {
				this.appliedEvents.push(event);
				this.expectedSeq = event.seq + 1;
				this.buffered.splice(index, 1);
			} else if (event.seq < expectedSeq) {
				// Stale buffered event, already contained: drop.
				this.buffered.splice(index, 1);
			} else {
				index++;
			}
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(() => resolve(), ms);
	});
}
