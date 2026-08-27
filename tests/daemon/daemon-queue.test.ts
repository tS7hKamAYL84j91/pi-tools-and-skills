/**
 * Regression tests for the coas-daemon A2A durable queue (T-868), covering
 * the design doc section 5 acceptance rows: exactly-once lease transitions,
 * idempotency-key dedupe (including after recovery), dead-letter on
 * tamper/expiry/attempts/generation-mismatch, parked recipients with no
 * attempt burn, parked->queued on binding appearance, late-ack semantics,
 * and idempotent recovery replay.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEnvelope, newMessageId, signEnvelope, verifyEnvelope } from "../../daemon/src/envelope.js";
import { canonicalJcs } from "../../daemon/src/jcs.js";
import { authorizeSend, loadPolicy, savePolicy } from "../../daemon/src/policy.js";
import {
	advanceDelivery,
	enqueue,
	expireExpiredRecords,
	findPriorOutcome,
	grantLease,
	loadQueueRecord,
	recoverQueue,
	MAX_ATTEMPTS,
	type QueueRecord,
} from "../../daemon/src/queue.js";
import { loadOrCreateIntegrityKey } from "../../daemon/src/keys.js";
import type { DaemonRoots } from "../../daemon/src/paths.js";

async function makeRoots(): Promise<DaemonRoots> {
	const base = await mkdtemp(join(tmpdir(), "coas-daemon-queue-"));
	return { runtimeRoot: join(base, "runtime"), stateRoot: join(base, "state") };
}

function makeEnqueueWithKeys(
	roots: DaemonRoots,
	keys: { keyId: string; publicKeyPem: string },
): (input: { signed: Parameters<typeof enqueue>[1]["signed"]; policyDecision: Parameters<typeof enqueue>[1]["policyDecision"] }) => ReturnType<typeof enqueue> {
	const verificationKeys = new Map([[keys.keyId, keys.publicKeyPem]]);
	return (input) => enqueue(roots, { ...input, verificationKeys });
}

interface QueueContext {
	readonly roots: DaemonRoots;
	readonly keys: { keyId: string; privateKeyPem: string; publicKeyPem: string };
	readonly enqueueWithKeys: (input: { signed: Parameters<typeof enqueue>[1]["signed"]; policyDecision: Parameters<typeof enqueue>[1]["policyDecision"] }) => ReturnType<typeof enqueue>;
	readonly cleanup: () => Promise<void>;
}

async function makeContext(): Promise<QueueContext> {
	const roots = await makeRoots();
	const keys = await loadOrCreateIntegrityKey(roots, async () => {});
	const enqueueWithKeys = makeEnqueueWithKeys(roots, keys);
	return {
		roots,
		keys,
		enqueueWithKeys,
		cleanup: async () => {
			await rm(roots.runtimeRoot, { recursive: true, force: true });
			await rm(roots.stateRoot, { recursive: true, force: true });
		},
	};
}

function signedFor(
	keys: { keyId: string; privateKeyPem: string },
	recipientAgentId: string,
	idempotencyKey: string,
	payload = "hello",
	expiresAt = new Date(Date.now() + 3600_000),
) {
	const envelope = buildEnvelope(keys, {
		idempotencyKey,
		expiresAt,
		sender: { agentId: "a-sender", instanceId: "i-s1", generation: 1 },
		recipientAgentId,
		recipientGenerationPolicy: "stable_mailbox",
		recipientGeneration: null,
		payloadType: "notice",
		payload,
	});
	return signEnvelope(keys.privateKeyPem, envelope);
}

describe("JCS canonicalization (A1: RFC 8785)", () => {
	it("sorts keys recursively and produces stable bytes", () => {
		const value = { b: 1, a: { d: "x", c: [2, 1] } };
		expect(canonicalJcs(value)).toBe('{"a":{"c":[2,1],"d":"x"},"b":1}');
	});
});

describe("envelope signing + verification (ADR section 3)", () => {
	it("round-trips a signed envelope and detects payload tampering", async () => {
		const roots = await makeRoots();
		try {
			const keys = await loadOrCreateIntegrityKey(roots, async () => {});
			const signed = signedFor(keys, "a-r", "k1");
			const verificationKeys = new Map([[keys.keyId, keys.publicKeyPem]]);
			expect(verifyEnvelope(signed, verificationKeys)).toEqual({ ok: true });

			const tampered: typeof signed = { envelope: { ...signed.envelope, payload: "evil" }, signature: signed.signature };
			expect(verifyEnvelope(tampered, verificationKeys)).toEqual({ ok: false, reason: "signature invalid" });
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});

describe("enqueue authorization + idempotency (ADR sections 4/6)", () => {
	it("rejects unmatched sends fail-closed and audits the rejection", async () => {
		const ctx = await makeContext();
		try {
			const signed = signedFor(ctx.keys, "a-recipient", "k1");
			const result = await ctx.enqueueWithKeys({ signed, policyDecision: { allowed: false, reason: "no allowlist entry matches (deny-by-default)" } });
			expect(result.enqueued).toBe(false);
			expect(result.rejectedReason).toContain("deny-by-default");
		} finally {
			await ctx.cleanup();
		}
	});

	it("returns the prior outcome for a replayed idempotency key", async () => {
		const ctx = await makeContext();
		try {
			const signed = signedFor(ctx.keys, "a-recipient", "key-1");
			const first = await ctx.enqueueWithKeys({ signed, policyDecision: { allowed: true } });
			expect(first.enqueued).toBe(true);
			const replay = await ctx.enqueueWithKeys({ signed, policyDecision: { allowed: true } });
			expect(replay.enqueued).toBe(false);
			expect(replay.prior?.messageId).toBe(signed.envelope.message_id);
			expect(replay.prior?.state).toBe("queued");
		} finally {
			await ctx.cleanup();
		}
	});

	it("finds the prior outcome in dead-letter storage after expiry (scan-derived index)", async () => {
		const ctx = await makeContext();
		try {
			const signed = signedFor(ctx.keys, "a-recipient", "key-dl", "payload", new Date(Date.now() - 1000));
			await ctx.enqueueWithKeys({ signed, policyDecision: { allowed: true } });
			await recoverQueue(ctx.roots, new Map([[ctx.keys.keyId, ctx.keys.publicKeyPem]]), new Date(), async () => {});
			const prior = await findPriorOutcome(ctx.roots, "a-recipient", "key-dl");
			expect(prior?.state).toBe("dead_letter");
		} finally {
			await ctx.cleanup();
		}
	});

	it("does not cross-match idempotency keys between recipients (review B4)", async () => {
		const ctx = await makeContext();
		try {
			const signedB = signedFor(ctx.keys, "a-recipient-b", "shared-key", "payload", new Date(Date.now() - 1000));
			await ctx.enqueueWithKeys({ signed: signedB, policyDecision: { allowed: true } });
			await recoverQueue(ctx.roots, new Map([[ctx.keys.keyId, ctx.keys.publicKeyPem]]), new Date(), async () => {});
			const prior = await findPriorOutcome(ctx.roots, "a-recipient", "shared-key");
			expect(prior).toBeUndefined();
		} finally {
			await ctx.cleanup();
		}
	});
});

describe("lease state machine (design doc section 5 transition table)", () => {
	it("walks queued -> leased -> delivered; delivered is terminal (late ack audited)", async () => {
		const ctx = await makeContext();
		try {
			const signed = signedFor(ctx.keys, "a-recipient", "k-term");
			await ctx.enqueueWithKeys({ signed, policyDecision: { allowed: true } });
			const now = new Date();

			const lease = await grantLease(ctx.roots, "a-recipient", signed.envelope.message_id, now);
			expect(lease.leased).toBe(true);
			expect(lease.record?.delivery.state).toBe("leased");

			const delivered = await advanceDelivery(ctx.roots, "a-recipient", signed.envelope.message_id, "delivered", now, lease.nonce);
			expect(delivered.state).toBe("delivered");

			const late = await advanceDelivery(ctx.roots, "a-recipient", signed.envelope.message_id, "delivered", now, lease.nonce);
			expect(late.state).toBe("delivered");
			expect(late.audit?.kind).toBe("terminal_violation");
		} finally {
			await ctx.cleanup();
		}
	});

	it("parks on absent binding without burning attempts (formal F3)", async () => {
		const ctx = await makeContext();
		try {
			const signed = signedFor(ctx.keys, "a-recipient", "k-off");
			await ctx.enqueueWithKeys({ signed, policyDecision: { allowed: true } });

			const parked = await advanceDelivery(ctx.roots, "a-recipient", signed.envelope.message_id, "no_binding", new Date());
			expect(parked.state).toBe("parked");
			const record = await loadQueueRecord(ctx.roots, "a-recipient", signed.envelope.message_id);
			expect(record?.delivery.attempts).toBe(0);
		} finally {
			await ctx.cleanup();
		}
	});

	it("requeues a parked record when a live binding appears (review B1)", async () => {
		const ctx = await makeContext();
		try {
			const signed = signedFor(ctx.keys, "a-recipient", "k-park");
			await ctx.enqueueWithKeys({ signed, policyDecision: { allowed: true } });
			const now = new Date();
			await advanceDelivery(ctx.roots, "a-recipient", signed.envelope.message_id, "no_binding", now);
			const parked = await loadQueueRecord(ctx.roots, "a-recipient", signed.envelope.message_id);
			expect(parked?.delivery.state).toBe("parked");

			const requeued = await advanceDelivery(ctx.roots, "a-recipient", signed.envelope.message_id, "requeue", now);
			expect(requeued.state).toBe("queued");
			const record = await loadQueueRecord(ctx.roots, "a-recipient", signed.envelope.message_id);
			expect(record?.delivery.attempts).toBe(0);
		} finally {
			await ctx.cleanup();
		}
	});

	it("dead-letters after MAX_ATTEMPTS live-binding failures", async () => {
		const ctx = await makeContext();
		try {
			const signed = signedFor(ctx.keys, "a-recipient", "k-fail");
			await ctx.enqueueWithKeys({ signed, policyDecision: { allowed: true } });
			const now = new Date();
			for (let i = 0; i < MAX_ATTEMPTS; i++) {
				const lease = await grantLease(ctx.roots, "a-recipient", signed.envelope.message_id, now);
				const step = await advanceDelivery(ctx.roots, "a-recipient", signed.envelope.message_id, "live_failed", now, lease.nonce);
				if (i < MAX_ATTEMPTS - 1) expect(step.state).toBe("queued");
			}
			const final = await loadQueueRecord(ctx.roots, "a-recipient", signed.envelope.message_id);
			expect(final?.delivery.state).toBe("dead_letter");
			expect(final?.delivery.deadLetterReason).toBe("attempts_exhausted");
			expect(final?.delivery.attempts).toBe(MAX_ATTEMPTS);
		} finally {
			await ctx.cleanup();
		}
	});

	it("runtime expiry sweep dead-letters expired non-terminal records (review B2)", async () => {
		const ctx = await makeContext();
		try {
			const signed = signedFor(ctx.keys, "a-recipient", "k-exp", "p", new Date(Date.now() - 1000));
			await ctx.enqueueWithKeys({ signed, policyDecision: { allowed: true } });
			const expiredCount = await expireExpiredRecords(ctx.roots, new Date());
			expect(expiredCount).toBe(1);
			const record = await loadQueueRecord(ctx.roots, "a-recipient", signed.envelope.message_id);
			expect(record?.delivery.state).toBe("dead_letter");
			expect(record?.delivery.deadLetterReason).toBe("expired");
		} finally {
			await ctx.cleanup();
		}
	});

	it("exact-generation mismatch dead-letters at the replacement boundary (review B3)", async () => {
		const ctx = await makeContext();
		try {
			const envelope = buildEnvelope(ctx.keys, {
				idempotencyKey: "k-exact",
				expiresAt: new Date(Date.now() + 3600_000),
				sender: { agentId: "a-sender", instanceId: "i-s1", generation: 1 },
				recipientAgentId: "a-recipient",
				recipientGenerationPolicy: "exact",
				recipientGeneration: 1,
				payloadType: "notice",
				payload: "p",
			});
			await ctx.enqueueWithKeys({ signed: signEnvelope(ctx.keys.privateKeyPem, envelope), policyDecision: { allowed: true } });
			const mismatched = await advanceDelivery(ctx.roots, "a-recipient", envelope.message_id, "generation_mismatch", new Date());
			expect(mismatched.state).toBe("dead_letter");
			const record = await loadQueueRecord(ctx.roots, "a-recipient", envelope.message_id);
			expect(record?.delivery.deadLetterReason).toBe("generation_mismatch");
		} finally {
			await ctx.cleanup();
		}
	});
});

describe("recovery replay (ADR section 7)", () => {
	it("replays non-terminal records idempotently and dead-letters tampered ones", async () => {
		const ctx = await makeContext();
		try {
			const good = signedFor(ctx.keys, "a-recipient", "k-good");
			await ctx.enqueueWithKeys({ signed: good, policyDecision: { allowed: true } });

			const tampered = signedFor(ctx.keys, "a-recipient", "k-bad", "original");
			const tamperedFile: QueueRecord = {
				signed: { envelope: { ...tampered.envelope, payload: "evil" }, signature: tampered.signature },
				delivery: { state: "queued", attempts: 0, enqueuedAt: new Date().toISOString() },
			};
			const recipientDir = join(ctx.roots.stateRoot, "queue", "a-recipient");
			await writeFile(join(recipientDir, `${newMessageId()}.json`), `${JSON.stringify(tamperedFile, null, 2)}\n`);

			const first = await recoverQueue(ctx.roots, new Map([[ctx.keys.keyId, ctx.keys.publicKeyPem]]), new Date(), async () => {});
			const second = await recoverQueue(ctx.roots, new Map([[ctx.keys.keyId, ctx.keys.publicKeyPem]]), new Date(), async () => {});
			expect(first.replayed).toBe(1);
			expect(first.deadLettered).toBe(1);
			expect(second.replayed).toBe(1);
			expect(second.deadLettered).toBe(0);

			const goodRecord = await loadQueueRecord(ctx.roots, "a-recipient", good.envelope.message_id);
			expect(goodRecord?.delivery.state).toBe("queued");
			const files = await readdir(recipientDir);
			expect(files.some((file) => file.includes("evil"))).toBe(false);
		} finally {
			await ctx.cleanup();
		}
	});
});

describe("policy authorization (ADR section 6)", () => {
	it("deny-by-default with type and generation constraints", async () => {
		const roots = await makeRoots();
		try {
			const keys = await loadOrCreateIntegrityKey(roots, async () => {});
			await savePolicy(roots, keys, [
				{ senderAgentId: "a-1", recipientAgentId: "a-2", payloadTypes: ["notice"] },
				{ senderAgentId: "a-1", recipientAgentId: "a-3", recipientGeneration: 4 },
			]);
			const verificationKeys = new Map([[keys.keyId, keys.publicKeyPem]]);
			const loaded = await loadPolicy(roots, verificationKeys);

			expect(authorizeSend(loaded, { senderAgentId: "a-1", recipientAgentId: "a-2", payloadType: "notice", recipientGeneration: null }).allowed).toBe(true);
			expect(authorizeSend(loaded, { senderAgentId: "a-1", recipientAgentId: "a-2", payloadType: "command", recipientGeneration: null }).allowed).toBe(false);
			expect(authorizeSend(loaded, { senderAgentId: "a-1", recipientAgentId: "a-3", payloadType: "notice", recipientGeneration: 4 }).allowed).toBe(true);
			expect(authorizeSend(loaded, { senderAgentId: "a-1", recipientAgentId: "a-3", payloadType: "notice", recipientGeneration: 5 }).allowed).toBe(false);
			expect(authorizeSend(loaded, { senderAgentId: "a-9", recipientAgentId: "a-2", payloadType: "notice", recipientGeneration: null }).allowed).toBe(false);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("rejects a tampered policy record", async () => {
		const roots = await makeRoots();
		try {
			const keys = await loadOrCreateIntegrityKey(roots, async () => {});
			await savePolicy(roots, keys, [{ senderAgentId: "a-1", recipientAgentId: "a-2" }]);
			const policyPath = join(roots.stateRoot, "registry", "policy.json");
			const parsed = JSON.parse(await readFile(policyPath, "utf8")) as { entries: unknown[]; signature: string };
			parsed.entries = [{ senderAgentId: "*", recipientAgentId: "*" }];
			await writeFile(policyPath, `${JSON.stringify(parsed, null, 2)}\n`);
			const verificationKeys = new Map([[keys.keyId, keys.publicKeyPem]]);
			await expect(loadPolicy(roots, verificationKeys)).rejects.toThrow(/signature invalid/);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});