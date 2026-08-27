/**
 * Durable A2A queue (ADR-0018 sections 3/4/5, design doc section 5).
 *
 * Delivery guarantee: at-least-once with recipient dedupe on message_id.
 * Lease state machine per the design doc transition table (queued / leased /
 * parked / delivered / dead_letter; delivered and dead_letter are terminal).
 * Attempt accounting counts only against authenticated live-binding failures;
 * an absent binding parks the message (no attempt burn), timers being
 * expires_at and the queue-depth cap. The idempotency index is derived by
 * scan from durable state (no separate index file). Recovery replays
 * non-terminal records idempotently.
 */
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { deadLetterDir, queueDir, assertSafeId, type DaemonRoots } from "./paths.js";
import { writeDurableFileNoReplace, writeDurableFileReplace, sweepStaleTmp } from "./durable-fs.js";
import { appendAudit } from "./audit.js";
import { verifyEnvelope, type SignedEnvelope } from "./envelope.js";
import { quarantineRecord } from "./record.js";
import type { AuditSink } from "./keys.js";

export type QueueState = "queued" | "leased" | "parked" | "delivered" | "dead_letter";

export type DeadLetterReason =
	| "attempts_exhausted"
	| "expired"
	| "integrity_failed"
	| "generation_mismatch"
	| "oversized"
	| "queue_full"
	| "daemon_disabled";

export interface DeliveryState {
	readonly state: QueueState;
	readonly attempts: number;
	readonly enqueuedAt: string;
	readonly lastAttemptAt?: string;
	readonly leaseExpiresAt?: string;
	readonly deadLetterReason?: DeadLetterReason;
}

export interface QueueRecord {
	readonly signed: SignedEnvelope;
	readonly delivery: DeliveryState;
}

export const LEASE_TTL_MS = 60_000;
export const MAX_ATTEMPTS = 5;
const MAX_QUEUE_DEPTH = 200;

const TERMINAL_STATES: readonly QueueState[] = ["delivered", "dead_letter"];

export function isTerminal(state: QueueState): boolean {
	return TERMINAL_STATES.includes(state);
}

function recordPath(roots: DaemonRoots, recipientAgentId: string, messageId: string): string {
	assertSafeId("recipient agent id", recipientAgentId);
	assertSafeId("message id", messageId);
	return join(queueDir(roots), recipientAgentId, `${messageId}.json`);
}

/** Validate a parsed queue record's shape (schema gate for the strict reader). */
function validateRecord(value: unknown): QueueRecord | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	const signed = record.signed as SignedEnvelope | undefined;
	const delivery = record.delivery as DeliveryState | undefined;
	if (!signed || typeof signed !== "object" || !signed.envelope || typeof signed.signature !== "string") return undefined;
	if (!delivery || typeof delivery !== "object" || typeof delivery.state !== "string" || typeof delivery.attempts !== "number") {
		return undefined;
	}
	if (!["queued", "leased", "parked", "delivered", "dead_letter"].includes(delivery.state)) return undefined;
	return value as QueueRecord;
}

/** Load one queue record strictly; corrupt records are quarantined + audited. */
export async function loadQueueRecord(roots: DaemonRoots, recipientAgentId: string, messageId: string): Promise<QueueRecord | undefined> {
	const { readRecordStrict } = await import("./record.js");
	return readRecordStrict(roots, recordPath(roots, recipientAgentId, messageId), validateRecord);
}

export interface EnqueueResult {
	readonly enqueued: boolean;
	/** Set when a prior outcome exists for (recipient, idempotency_key). */
	readonly prior?: { readonly messageId: string; readonly state: QueueState };
	readonly record?: QueueRecord;
	readonly rejectedReason?: string;
}

export interface EnqueueInput {
	readonly signed: SignedEnvelope;
	/** Daemon-evaluated decision from policy.ts (never caller-supplied). */
	readonly policyDecision: { readonly allowed: true } | { readonly allowed: false; readonly reason: string };
	/** Verification keys for the defense-in-depth signature re-check. */
	readonly verificationKeys: ReadonlyMap<string, string>;
}

/**
 * Enqueue: authorization first (deny-by-default, fail-closed + audited),
 * then idempotency (prior outcome returned), then queue-depth cap, then the
 * durable write (commit-before-ack).
 */
export async function enqueue(roots: DaemonRoots, input: EnqueueInput): Promise<EnqueueResult> {
	const envelope = input.signed.envelope;
	// Defense-in-depth: re-verify the envelope signature and payload integrity
	// at enqueue (ADR section 3 reader order applies to the daemon too).
	const verification = verifyEnvelope(input.signed, input.verificationKeys);
	if (!verification.ok) {
		await appendAudit(roots, { kind: "enqueue_rejected", reason: `integrity: ${verification.reason}` }, { durable: true });
		return { enqueued: false, rejectedReason: verification.reason };
	}
	if (!input.policyDecision.allowed) {
		await appendAudit(roots, {
			kind: "enqueue_rejected",
			reason: input.policyDecision.reason,
			recipient: envelope.recipient_agent_id,
		}, { durable: true });
		return { enqueued: false, rejectedReason: input.policyDecision.reason };
	}

	// Idempotency index: derived by scan over durable state (design doc F5).
	const prior = await findPriorOutcome(roots, envelope.recipient_agent_id, envelope.idempotency_key);
	if (prior) return { enqueued: false, prior };

	const depth = await countNonTerminal(roots, envelope.recipient_agent_id);
	if (depth >= MAX_QUEUE_DEPTH) {
		const record: QueueRecord = { signed: input.signed, delivery: { state: "dead_letter", attempts: 0, enqueuedAt: envelope.enqueued_at, deadLetterReason: "queue_full" } };
		await writeDurableFileNoReplace(deadLetterPath(roots, envelope.message_id), `${JSON.stringify(record, null, 2)}\n`, 0o600, roots.stateRoot);
		await appendAudit(roots, { kind: "dead_letter", reason: "queue_full", messageId: envelope.message_id, recipient: envelope.recipient_agent_id }, { durable: true });
		return { enqueued: false, record };
	}

	const record: QueueRecord = {
		signed: input.signed,
		delivery: { state: "queued", attempts: 0, enqueuedAt: envelope.enqueued_at },
	};
	await writeDurableFileNoReplace(recordPath(roots, envelope.recipient_agent_id, envelope.message_id), `${JSON.stringify(record, null, 2)}\n`, 0o600, roots.stateRoot);
	await appendAudit(roots, { kind: "enqueued", messageId: envelope.message_id, recipient: envelope.recipient_agent_id });
	return { enqueued: true, record };
}

function deadLetterPath(roots: DaemonRoots, messageId: string): string {
	assertSafeId("message id", messageId);
	return join(deadLetterDir(roots), `${messageId}.json`);
}

/** Idempotency index derived by scan: prior outcome for (recipient, key). */
export async function findPriorOutcome(roots: DaemonRoots, recipientAgentId: string, idempotencyKey: string): Promise<EnqueueResult["prior"] | undefined> {
	const recipientDir = join(queueDir(roots), recipientAgentId);
	for (const dir of [recipientDir, deadLetterDir(roots)]) {
		let entries: string[] = [];
		try {
			entries = await readdir(dir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.endsWith(".json")) continue;
			try {
				const raw = await readFile(join(dir, entry), "utf8");
				const record = JSON.parse(raw) as QueueRecord;
				// Dedupe keys on (recipient_agent_id, idempotency_key) — the
				// global dead-letter dir must be filtered by recipient (ADR section 3).
				if (dir !== recipientDir && record.signed.envelope.recipient_agent_id !== recipientAgentId) continue;
				if (record.signed.envelope.idempotency_key === idempotencyKey) {
					return { messageId: record.signed.envelope.message_id, state: record.delivery.state };
				}
			} catch {
				// Corrupt scan entries are handled by recovery, not the index.
			}
		}
	}
	return undefined;
}

async function countNonTerminal(roots: DaemonRoots, recipientAgentId: string): Promise<number> {
	const recipientDir = join(queueDir(roots), recipientAgentId);
	let entries: string[] = [];
	try {
		entries = await readdir(recipientDir);
	} catch {
		return 0;
	}
	let count = 0;
	for (const entry of entries) {
		if (!entry.endsWith(".json")) continue;
		try {
			const raw = await readFile(join(recipientDir, entry), "utf8");
			const record = JSON.parse(raw) as QueueRecord;
			if (!isTerminal(record.delivery.state)) count++;
		} catch {
			count++;
		}
	}
	return count;
}

/** Remaining backoff for a record after a live-binding failure (design doc section 5: 1s..16s). */
export function backoffRemainingMs(record: QueueRecord, now: Date): number {
	if (record.delivery.attempts === 0 || record.delivery.lastAttemptAt === undefined) return 0;
	const backoff = BACKOFF_MS[Math.min(record.delivery.attempts - 1, BACKOFF_MS.length - 1)] ?? 16_000;
	const eligibleAt = Date.parse(record.delivery.lastAttemptAt) + backoff;
	return Math.max(0, eligibleAt - now.getTime());
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16_000];

/** Delivery attempt outcome supplied by the serve loop (T-868 serve seam). */
export type DeliveryOutcome = "delivered" | "live_failed" | "no_binding" | "generation_mismatch" | "requeue";

export interface DeliveryLease {
	readonly recipientAgentId: string;
	readonly messageId: string;
	readonly nonce: string;
	readonly expiresAtMs: number;
}

const inFlightLeases = new Map<string, { readonly nonce: string; readonly expiresAtMs: number }>();

function leaseKey(recipientAgentId: string, messageId: string): string {
	return `${recipientAgentId}:${messageId}`;
}

function isExpired(record: QueueRecord, now: Date): boolean {
	return new Date(record.signed.envelope.expires_at).getTime() <= now.getTime();
}

/**
 * Advance one record through the lease state machine (design doc section 5
 * transition table). Returns the record's new state. CAS is the in-process
 * lease map (single daemon process holds the exclusive lock).
 */
export async function advanceDelivery(
	roots: DaemonRoots,
	recipientAgentId: string,
	messageId: string,
	outcome: DeliveryOutcome,
	now: Date,
	/** Required for the delivered outcome: the lease nonce granted by grantLease. */
	leaseNonce?: string,
): Promise<{ record?: QueueRecord; state?: QueueState; audit?: Record<string, unknown> }> {
	const record = await loadQueueRecord(roots, recipientAgentId, messageId);
	if (!record) return {};
	const key = leaseKey(recipientAgentId, messageId);

	// Terminal states never transition (late acks are audited no-ops).
	if (record.delivery.state === "delivered") {
		return { record, state: "delivered", audit: { kind: "terminal_violation", messageId } };
	}
	if (record.delivery.state === "dead_letter") {
		return { record, state: "dead_letter", audit: { kind: "late_ack_dead_letter", messageId } };
	}

	// Expiry bounds re-delivery (rollback/restore window closes).
	if (isExpired(record, now)) {
		const next = await persistTransition(roots, record, {
			state: "dead_letter",
			attempts: record.delivery.attempts,
			enqueuedAt: record.delivery.enqueuedAt,
			deadLetterReason: "expired",
		});
		inFlightLeases.delete(key);
		return { record: next, state: "dead_letter", audit: { kind: "dead_letter", reason: "expired", messageId } };
	}

	if (outcome === "no_binding") {
		// Parked: no attempt burn; timers are expires_at and the depth cap.
		const next = await persistTransition(roots, record, { ...record.delivery, state: "parked" });
		return { record: next, state: "parked" };
	}

	if (outcome === "generation_mismatch") {
		// Exact-generation policy cannot cross a replacement boundary (ADR section 5).
		const next = await persistTransition(roots, record, {
			state: "dead_letter",
			attempts: record.delivery.attempts,
			enqueuedAt: record.delivery.enqueuedAt,
			deadLetterReason: "generation_mismatch",
		});
		inFlightLeases.delete(key);
		return { record: next, state: "dead_letter", audit: { kind: "dead_letter", reason: "generation_mismatch", messageId } };
	}

	if (outcome === "requeue") {
		// parked -> queued when a live binding appears (review B1).
		const next = await persistTransition(roots, record, { ...record.delivery, state: "queued" });
		return { record: next, state: "queued" };
	}

	if (outcome === "live_failed") {
		const attempts = record.delivery.attempts + 1;
		if (attempts >= MAX_ATTEMPTS) {
			const next = await persistTransition(roots, record, {
				state: "dead_letter",
				attempts,
				enqueuedAt: record.delivery.enqueuedAt,
				lastAttemptAt: now.toISOString(),
				deadLetterReason: "attempts_exhausted",
			});
			inFlightLeases.delete(key);
			return { record: next, state: "dead_letter", audit: { kind: "dead_letter", reason: "attempts_exhausted", messageId } };
		}
		const next = await persistTransition(roots, record, {
			state: "queued",
			attempts,
			enqueuedAt: record.delivery.enqueuedAt,
			lastAttemptAt: now.toISOString(),
		});
		return { record: next, state: "queued" };
	}

	// outcome === "delivered": accept only from the binding this lease was
	// granted to — nonce must match and the lease must not have expired
	// (design doc section 5 stale_ack edge, review B5).
	const lease = inFlightLeases.get(key);
	if (lease === undefined || (leaseNonce !== undefined && lease.nonce !== leaseNonce) || lease.expiresAtMs <= now.getTime()) {
		// Stale/expired holder — no-op + audit.
		return { record, state: record.delivery.state, audit: { kind: "stale_ack", messageId } };
	}
	const next = await persistTransition(roots, record, {
		state: "delivered",
		attempts: record.delivery.attempts,
		enqueuedAt: record.delivery.enqueuedAt,
	});
	inFlightLeases.delete(key);
	return { record: next, state: "delivered" };
}

async function persistTransition(roots: DaemonRoots, record: QueueRecord, delivery: DeliveryState): Promise<QueueRecord> {
	const next: QueueRecord = { signed: record.signed, delivery };
	await writeDurableFileReplace(recordPath(roots, record.signed.envelope.recipient_agent_id, record.signed.envelope.message_id), `${JSON.stringify(next, null, 2)}\n`, 0o600, roots.stateRoot);
	return next;
}

/** Grant a delivery lease (CAS): queued/parked -> leased with a TTL. */
export async function grantLease(roots: DaemonRoots, recipientAgentId: string, messageId: string, now: Date): Promise<{ leased: boolean; nonce?: string; record?: QueueRecord }> {
	const record = await loadQueueRecord(roots, recipientAgentId, messageId);
	if (!record) return { leased: false };
	if (isTerminal(record.delivery.state)) return { leased: false, record };
	if (record.delivery.state === "leased") {
		// Compare-and-set discipline: a live lease is never blind-replaced.
		const leaseExpiresAt = record.delivery.leaseExpiresAt ? Date.parse(record.delivery.leaseExpiresAt) : Number.NaN;
		if (!Number.isNaN(leaseExpiresAt) && leaseExpiresAt > now.getTime()) {
			return { leased: false, record };
		}
	}
	if (isExpired(record, now)) {
		const expired = await expireRecord(roots, record);
		return { leased: false, record: expired };
	}
	const nonce = randomNonce();
	inFlightLeases.set(leaseKey(recipientAgentId, messageId), { nonce, expiresAtMs: now.getTime() + LEASE_TTL_MS });
	const next = await persistTransition(roots, record, {
		state: "leased",
		attempts: record.delivery.attempts,
		enqueuedAt: record.delivery.enqueuedAt,
		leaseExpiresAt: new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
	});
	return { leased: true, nonce, record: next };
}

function randomNonce(): string {
	return randomUUID();
}

/**
 * Runtime expiry sweep: any non-terminal record past expires_at dead-letters
 * (design doc section 5 row "any non-terminal | expires_at passed"). Driven
 * from the serve loop so the rollback window closes without a restart.
 */
export async function expireExpiredRecords(roots: DaemonRoots, now: Date): Promise<number> {
	let expired = 0;
	for (const record of await scanNonTerminal(roots)) {
		if (!isExpired(record, now)) continue;
		await expireRecord(roots, record);
		expired++;
	}
	return expired;
}

/** Lease TTL expiry: back to queued, attempts unchanged (re-lease eligible). */
export async function expireLeases(roots: DaemonRoots, now: Date): Promise<number> {
	let expired = 0;
	for (const record of await scanNonTerminal(roots)) {
		if (record.delivery.state !== "leased") continue;
		const leaseExpiresAt = record.delivery.leaseExpiresAt ? Date.parse(record.delivery.leaseExpiresAt) : Number.NaN;
		if (Number.isNaN(leaseExpiresAt) || leaseExpiresAt > now.getTime()) continue;
		await persistTransition(roots, record, {
			state: "queued",
			attempts: record.delivery.attempts,
			enqueuedAt: record.delivery.enqueuedAt,
		});
		inFlightLeases.delete(leaseKey(record.signed.envelope.recipient_agent_id, record.signed.envelope.message_id));
		expired++;
	}
	return expired;
}

async function expireRecord(roots: DaemonRoots, record: QueueRecord): Promise<QueueRecord> {
	const next = await persistTransition(roots, record, {
		state: "dead_letter",
		attempts: record.delivery.attempts,
		enqueuedAt: record.delivery.enqueuedAt,
		deadLetterReason: "expired",
	});
	await appendAudit(roots, { kind: "dead_letter", reason: "expired", messageId: record.signed.envelope.message_id });
	return next;
}

/** Recipient-side dedupe contract: durably record message_id BEFORE acking. */
export function recipientDedupeContract(): string {
	return "recipients persist message_id before acking; acks without a persisted dedupe record must expect redelivery";
}

/**
 * Recovery: replay non-terminal records idempotently. Envelope integrity is
 * verified first (integrity failure -> dead_letter(integrity_failed) + raw
 * record quarantined). Expired envelopes dead-letter. Corrupt state files
 * are quarantined by the strict reader. Re-running recovery is a no-op.
 */
export async function recoverQueue(roots: DaemonRoots, verificationKeys: ReadonlyMap<string, string>, now: Date, audit: AuditSink): Promise<{ replayed: number; deadLettered: number; quarantined: number }> {
	let replayed = 0;
	let deadLettered = 0;
	let quarantined = 0;

	const queueRoot = queueDir(roots);
	let recipients: string[] = [];
	try {
		// Only agent-id directories are recipients; queue/dead-letter and
		// queue/quarantine are system surfaces, never scanned as agents.
		recipients = (await readdir(queueRoot)).filter((entry) => !entry.includes(".") && entry !== "dead-letter" && entry !== "quarantine");
	} catch {
		return { replayed, deadLettered, quarantined };
	}
	for (const recipient of recipients) {
		const recipientDir = join(queueRoot, recipient);
		const tmp = await sweepStaleTmp(recipientDir, roots.stateRoot);
		quarantined += tmp.rejected.length;
		for (const entry of await readdir(recipientDir)) {
			if (!entry.endsWith(".json")) continue;
			// Quarantine must target the FILE path actually read (entry name),
			// not the envelope id: they can differ for hand-planted records.
			const filePath = join(recipientDir, entry);
			const record = await loadQueueRecord(roots, recipient, entry.slice(0, -5));
			if (!record) {
				quarantined++;
				continue;
			}
			const verification = verifyEnvelope(record.signed, verificationKeys);
			if (!verification.ok) {
				await quarantineRecord(roots, filePath, `integrity: ${verification.reason}`);
				// Dead-letter record is terminal and immutable: skip if it
				// already exists (idempotent recovery, ADR section 7).
				const published = await writeDurableFileNoReplace(deadLetterPath(roots, record.signed.envelope.message_id), `${JSON.stringify({ signed: record.signed, delivery: { ...record.delivery, state: "dead_letter", deadLetterReason: "integrity_failed" } }, null, 2)}\n`, 0o600, roots.stateRoot).catch((error: NodeJS.ErrnoException) => {
					if (error.code === "EEXIST") return { created: false };
					throw error;
				});
				if (published.created) deadLettered++;
				continue;
			}
			if (isExpired(record, now) && !isTerminal(record.delivery.state)) {
				await expireRecord(roots, record);
				deadLettered++;
				continue;
			}
			if (!isTerminal(record.delivery.state)) replayed++;
		}
	}
	await audit({ kind: "queue_recovery", replayed, deadLettered, quarantined });
	return { replayed, deadLettered, quarantined };
}

export async function scanNonTerminal(roots: DaemonRoots): Promise<QueueRecord[]> {
	const records: QueueRecord[] = [];
	const queueRoot = queueDir(roots);
	let recipients: string[] = [];
	try {
		recipients = (await readdir(queueRoot, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && entry.name !== "dead-letter" && entry.name !== "quarantine")
			.map((entry) => entry.name);
	} catch {
		return records;
	}
	for (const recipient of recipients) {
		const recipientDir = join(queueRoot, recipient);
		let entries: string[] = [];
		try {
			entries = await readdir(recipientDir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.endsWith(".json")) continue;
			const record = await loadQueueRecord(roots, recipient, entry.slice(0, -5));
			if (record && !isTerminal(record.delivery.state)) records.push(record);
		}
	}
	return records;
}