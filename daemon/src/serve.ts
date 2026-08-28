/**
 * Delivery serve loop (design doc sections 5/8, ADR section 4): grants
 * leases, delivers over authenticated live bindings with a timeout below
 * the lease TTL, parks messages whose recipient has no binding (no attempt
 * burn), enforces the per-tick budget with round-robin fairness, and handles
 * recipient acks against the daemon-owned binding. Recipients persist
 * message_id before acking (dedupe-persist-before-ack contract); the daemon
 * never treats a caller-supplied identity as a binding (T-867 reviewer A2).
 */
import { timingSafeEqual } from "node:crypto";
import { appendAudit } from "./audit.js";
import { advanceDelivery, backoffRemainingMs, expireExpiredRecords, expireLeases, grantLease, scanNonTerminal, type DeliveryOutcome, type QueueRecord } from "./queue.js";
import { capabilityProof } from "./admission.js";
import type { DaemonRoots } from "./paths.js";
import type { AuditSink } from "./keys.js";

export const DELIVERY_TIMEOUT_MS = 5_000;
export const PER_TICK_BUDGET = 32;

/** Serve-level outcome: DeliveryOutcome plus the parked case. */
export type ServeOutcome = DeliveryOutcome | "parked";

export interface LiveBindingConnection {
	readonly agentId: string;
	readonly instanceId: string;
	readonly generation: number;
	readonly label: "same_uid_untrusted";
	readonly capabilitySecret: string;
	/** Registry-derived guard inputs (design doc section 5a). */
	readonly guardInputs: { readonly parentId: string | null; readonly visibility: string; readonly scope: "root" | "task" | "workspace" };
	/** Bounded send; the serve loop races it against DELIVERY_TIMEOUT_MS. */
	readonly send: (payload: string) => Promise<"ack" | "nack" | "timeout">;
}

/** Ack from a recipient: capability possession proof over the message id. */
export interface AckInput {
	readonly recipientAgentId: string;
	readonly messageId: string;
	readonly capabilitySecret: string;
}

export interface TickResult {
	readonly attempted: number;
	readonly parked: number;
	readonly delivered: number;
	readonly failed: number;
}

export interface ServeLoopOptions {
	/** Delivery send timeout; must stay below the lease TTL (60s). */
	readonly deliveryTimeoutMs?: number;
	readonly perTickBudget?: number;
}

export class DeliveryServeLoop {
	private readonly bindings = new Map<string, LiveBindingConnection>();
	private roundRobinIndex = 0;
	private readonly deliveryTimeoutMs: number;
	private readonly perTickBudget: number;
	readonly counters = { delivered: 0, liveFailed: 0, parked: 0, deadLettered: 0, ticks: 0 };

	constructor(
		private readonly roots: DaemonRoots,
		private readonly audit: AuditSink,
		options: ServeLoopOptions = {},
	) {
		this.deliveryTimeoutMs = options.deliveryTimeoutMs ?? DELIVERY_TIMEOUT_MS;
		this.perTickBudget = options.perTickBudget ?? PER_TICK_BUDGET;
	}

	/** Register/deregister an authenticated live binding (serve-loop-owned state). */
	bind(connection: LiveBindingConnection): void {
		this.bindings.set(connection.agentId, connection);
	}

	unbind(agentId: string): void {
		this.bindings.delete(agentId);
	}

	/** Live binding for a recipient, from daemon-owned state only. */
	bindingFor(agentId: string): LiveBindingConnection | undefined {
		return this.bindings.get(agentId);
	}

	/**
	 * One delivery tick: round-robin across recipients with a live binding,
	 * one delivery per recipient per tick (fairness), bounded by the per-tick
	 * budget. Each send is timeout-bounded below the lease TTL, so one hung
	 * recipient cannot starve others.
	 */
	async tick(now: Date): Promise<TickResult> {
		// Runtime expiry sweep first: any non-terminal record past expires_at
		// dead-letters (review B2 — the rollback window closes without restart).
		await expireExpiredRecords(this.roots, now);
		// Lease TTL expiry: leased records whose lease lapsed return to queued.
		await expireLeases(this.roots, now);

		const records = await scanNonTerminal(this.roots);
		const eligible = records.filter((record) => {
			if (record.delivery.state === "queued") return this.backoffElapsed(record, now);
			// Parked records with a live binding requeue immediately (review B1):
			// the parked->queued edge of the transition table.
			if (record.delivery.state === "parked" && this.bindings.has(record.signed.envelope.recipient_agent_id)) {
				return true;
			}
			return false;
		});

		const byRecipient = new Map<string, QueueRecord>();
		for (const record of eligible) {
			const recipient = record.signed.envelope.recipient_agent_id;
			if (!byRecipient.has(recipient)) byRecipient.set(recipient, record);
		}
		const recipients = [...byRecipient.keys()].sort();

		let attempted = 0;
		let parked = 0;
		let delivered = 0;
		let failed = 0;
		for (let offset = 0; offset < recipients.length && attempted < this.perTickBudget; offset++) {
			const recipient = recipients[(this.roundRobinIndex + offset) % recipients.length] ?? "";
			const record = byRecipient.get(recipient);
			if (!record) continue;
			const outcome = await this.deliverOne(record, now);
			attempted++;
			if (outcome === "parked") parked++;
			else if (outcome === "delivered") delivered++;
			else failed++;
		}
		if (recipients.length > 0) this.roundRobinIndex = (this.roundRobinIndex + 1) % recipients.length;
		this.counters.ticks++;
		return { attempted, parked, delivered, failed };
	}

	/** Retry backoff (design doc section 5: 1s..16s after live-binding failures). */
	private backoffElapsed(record: QueueRecord, now: Date): boolean {
		return backoffRemainingMs(record, now) === 0;
	}

	private async deliverOne(record: QueueRecord, now: Date): Promise<ServeOutcome> {
		const recipient = record.signed.envelope.recipient_agent_id;
		const messageId = record.signed.envelope.message_id;
		const binding = this.bindings.get(recipient);
		if (!binding) {
			// Parked: no attempt burn; timers are expires_at and the depth cap.
			await advanceDelivery(this.roots, recipient, messageId, "no_binding", now);
			this.counters.parked++;
			return "parked";
		}

		// Generation policy enforcement (review B3): an exact-generation
		// envelope cannot cross a replacement boundary (ADR section 5);
		// stable_mailbox delivers to any later authenticated generation.
		const generation = binding.generation;
		const policy = record.signed.envelope.recipient_generation_policy;
		const required = record.signed.envelope.recipient_generation;
		if (policy === "exact" && required !== null && generation !== required) {
			const advanced = await advanceDelivery(this.roots, recipient, messageId, "generation_mismatch", now);
			if (advanced.state === "dead_letter") this.counters.deadLettered++;
			await this.audit({ kind: "generation_mismatch", messageId, recipient, required, actual: generation });
			return "live_failed";
		}

		// Delivery-seam guard (ADR-0008 (6)/(7)): daemon-ticked delivery targets
		// root-admitted bindings only; non-root scopes drop+log+alert.
		if (binding.guardInputs.scope !== "root") {
			await this.audit({
				kind: "delivery_guard_dropped",
				messageId,
				recipient,
				scope: binding.guardInputs.scope,
				reason: "non-root binding is not a delivery target",
			});
			const dropped = await advanceDelivery(this.roots, recipient, messageId, "live_failed", now);
			if (dropped.state === "dead_letter") this.counters.deadLettered++;
			return "live_failed";
		}

		const lease = await grantLease(this.roots, recipient, messageId, now);
		if (!lease.leased || !lease.record || lease.nonce === undefined) return "live_failed";

		const send = binding.send(record.signed.envelope.payload).then(
			(result): DeliveryOutcome => (result === "ack" ? "delivered" : "live_failed"),
			(): DeliveryOutcome => "live_failed",
		);
		const timeout = new Promise<DeliveryOutcome>((resolve) => {
			setTimeout(() => resolve("live_failed"), this.deliveryTimeoutMs);
		});
		const outcome = await Promise.race([send, timeout]);

		const advanced = await advanceDelivery(this.roots, recipient, messageId, outcome, now, lease.nonce);
		if (outcome === "delivered") this.counters.delivered++;
		else this.counters.liveFailed++;
		if (advanced.state === "dead_letter") this.counters.deadLettered++;
		await this.audit({ kind: "delivery_attempt", messageId, recipient, outcome, posture: "same_uid_untrusted" });
		return outcome;
	}

	/**
	 * Recipient ack: verifies the capability proof (possession) and that the
	 * record is deliverable, then records delivery. The recipient must have
	 * persisted message_id BEFORE acking (dedupe-persist-before-ack contract):
	 * an ack without the persisted dedupe record must expect redelivery, which
	 * at-least-once + recipient dedupe absorbs.
	 */
	async ack(input: AckInput): Promise<{ accepted: boolean; reason?: string }> {
		const binding = this.bindings.get(input.recipientAgentId);
		if (!binding) return { accepted: false, reason: "no live binding" };
		const expected = capabilityProof(binding.capabilitySecret, input.messageId);
		const provided = capabilityProof(input.capabilitySecret, input.messageId);
		if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
			return { accepted: false, reason: "capability proof mismatch" };
		}
		const advanced = await advanceDelivery(this.roots, input.recipientAgentId, input.messageId, "delivered", new Date());
		if (advanced.state !== "delivered") {
			return { accepted: false, reason: `ack not accepted in state ${advanced.state ?? "unknown"}` };
		}
		await appendAudit(this.roots, { kind: "delivery_ack", messageId: input.messageId, recipient: input.recipientAgentId, posture: "same_uid_untrusted" });
		return { accepted: true };
	}
}