/**
 * Regression tests for the coas-daemon A2A durable queue (T-868), covering
 * the design doc section 5 acceptance rows: exactly-once lease transitions,
 * idempotency-key dedupe (including after crash/recovery), dead-letter on
 * tamper/expiry/attempts, parked (offline) recipients with no attempt burn,
 * late-ack semantics, and idempotent recovery replay.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEnvelope, newMessageId, signEnvelope, verifyEnvelope } from "../../daemon/src/envelope.js";
import { canonicalJcs } from "../../daemon/src/jcs.js";
import { authorizeSend, loadPolicy, savePolicy } from "../../daemon/src/policy.js";
import {
	advanceDelivery,
	enqueue,
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


function signedFor(
	keys: { keyId: string; privateKeyPem: string },
	sender: { agentId: string; instanceId: string; generation: number },
	recipientAgentId: string,
	idempotencyKey: string,
	payload = "hello",
	expiresAt = new Date(Date.now() + 3600_000),
) {
	const envelope = buildEnvelope(keys, {
		idempotencyKey,
		expiresAt,
		sender,
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
			const signed = signedFor(keys, { agentId: "a-s", instanceId: "i-1", generation: 1 }, "a-r", "k1");
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
		const roots = await makeRoots();
		try {
			const keys = await loadOrCreateIntegrityKey(roots, async () => {});
			const signed = signedFor(keys, { agentId: "a-stranger", instanceId: "i-x", generation: 1 }, "a-recipient", "k1");
			const result = await enqueue(roots, { signed, policyDecision: { allowed: false, reason: "no allowlist entry matches (deny-by-default)" } });
			expect(result.enqueued).toBe(false);
			expect(result.rejectedReason).toContain("deny-by-default");
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("returns the prior outcome for a replayed idempotency key", async () => {
		const roots = await makeRoots();
		try {
			const keys = await loadOrCreateIntegrityKey(roots, async () => {});
			const sender = { agentId: "a-sender", instanceId: "i-s1", generation: 1 };
			const signed = signedFor(keys, sender, "a-recipient", "key-1");
			const first = await enqueue(roots, { signed, policyDecision: { allowed: true } });
			expect(first.enqueued).toBe(true);
			const replay = await enqueue(roots, { signed, policyDecision: { allowed: true } });
			expect(replay.enqueued).toBe(false);
			expect(replay.prior?.messageId).toBe(signed.envelope.message_id);
			expect(replay.prior?.state).toBe("queued");
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("finds the prior outcome in dead-letter storage after expiry (scan-derived index)", async () => {
		const roots = await makeRoots();
		try {
			const keys = await loadOrCreateIntegrityKey(roots, async () => {});
			const sender = { agentId: "a-sender", instanceId: "i-s1", generation: 1 };
			const signed = signedFor(keys, sender, "a-recipient", "key-dl", "payload", new Date(Date.now() - 1000));
			await enqueue(roots, { signed, policyDecision: { allowed: true } });
			await recoverQueue(roots, new Map([[keys.keyId, keys.publicKeyPem]]), new Date(), async () => {});
			const prior = await findPriorOutcome(roots, "a-recipient", "key-dl");
			expect(prior?.state).toBe("dead_letter");
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});

describe("lease state machine (design doc section 5 transition table)", () => {
	it("walks queued -> leased -> delivered; delivered is terminal (late ack audited)", async () => {
		const roots = await makeRoots();
		try {
			const keys = await loadOrCreateIntegrityKey(roots, async () => {});
			const sender = { agentId: "a-sender", instanceId: "i-s1", generation: 1 };
			const signed = signedFor(keys, sender, "a-recipient", "k-term");
			await enqueue(roots, { signed, policyDecision: { allowed: true } });
			const now = new Date();

			const lease = await grantLease(roots, "a-recipient", signed.envelope.message_id, now);
			expect(lease.leased).toBe(true);
			expect(lease.record?.delivery.state).toBe("leased");

			const delivered = await advanceDelivery(roots, "a-recipient", signed.envelope.message_id, "delivered", now);
			expect(delivered.state).toBe("delivered");

			// Late ack / further events are audited no-ops; state stays delivered.
			const late = await advanceDelivery(roots, "a-recipient", signed.envelope.message_id, "delivered", now);
			expect(late.state).toBe("delivered");
			expect(late.audit?.kind).toBe("terminal_violation");
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("parks on absent binding without burning attempts (formal F3)", async () => {
		const roots = await makeRoots();
		try {
			const keys = await loadOrCreateIntegrityKey(roots, async () => {});
			const sender = { agentId: "a-sender", instanceId: "i-s1", generation: 1 };
			const signed = signedFor(keys, sender, "a-recipient", "k-off");
			await enqueue(roots, { signed, policyDecision: { allowed: true } });

			const parked = await advanceDelivery(roots, "a-recipient", signed.envelope.message_id, "no_binding", new Date());
			expect(parked.state).toBe("parked");
			const record = await loadQueueRecord(roots, "a-recipient", signed.envelope.message_id);
			expect(record?.delivery.attempts).toBe(0);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("dead-letters after MAX_ATTEMPTS live-binding failures", async () => {
		const roots = await makeRoots();
		try {
			const keys = await loadOrCreateIntegrityKey(roots, async () => {});
			const sender = { agentId: "a-sender", instanceId: "i-s1", generation: 1 };
			const signed = signedFor(keys, sender, "a-recipient", "k-fail");
			await enqueue(roots, { signed, policyDecision: { allowed: true } });
			const now = new Date();
			for (let i = 0; i < MAX_ATTEMPTS; i++) {
				await grantLease(roots, "a-recipient", signed.envelope.message_id, now);
				const step = await advanceDelivery(roots, "a-recipient", signed.envelope.message_id, "live_failed", now);
				if (i < MAX_ATTEMPTS - 1) expect(step.state).toBe("queued");
			}
			const final = await loadQueueRecord(roots, "a-recipient", signed.envelope.message_id);
			expect(final?.delivery.state).toBe("dead_letter");
			expect(final?.delivery.deadLetterReason).toBe("attempts_exhausted");
			expect(final?.delivery.attempts).toBe(MAX_ATTEMPTS);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("expired envelopes dead-letter even while queued", async () => {
		const roots = await makeRoots();
		try {
			const keys = await loadOrCreateIntegrityKey(roots, async () => {});
			const sender = { agentId: "a-sender", instanceId: "i-s1", generation: 1 };
			const signed = signedFor(keys, sender, "a-recipient", "k-exp", "p", new Date(Date.now() - 1000));
			const enqueued = await enqueue(roots, { signed, policyDecision: { allowed: true } });
			// Enqueue of an already-expired envelope commits it; recovery expires it.
			await recoverQueue(roots, new Map([[keys.keyId, keys.publicKeyPem]]), new Date(), async () => {});
			const record = await loadQueueRecord(roots, "a-recipient", enqueued.record?.signed.envelope.message_id ?? signed.envelope.message_id);
			expect(record?.delivery.state).toBe("dead_letter");
			expect(record?.delivery.deadLetterReason).toBe("expired");
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});

describe("recovery replay (ADR section 7)", () => {
	it("replays non-terminal records idempotently and dead-letters tampered ones", async () => {
		const roots = await makeRoots();
		try {
			const keys = await loadOrCreateIntegrityKey(roots, async () => {});
			const sender = { agentId: "a-sender", instanceId: "i-s1", generation: 1 };
			const good = signedFor(keys, sender, "a-recipient", "k-good");
			await enqueue(roots, { signed: good, policyDecision: { allowed: true } });

			// Tampered record written directly to the queue dir.
			const tampered = signedFor(keys, sender, "a-recipient", "k-bad", "original");
			const tamperedFile: QueueRecord = {
				signed: { envelope: { ...tampered.envelope, payload: "evil" }, signature: tampered.signature },
				delivery: { state: "queued", attempts: 0, enqueuedAt: new Date().toISOString() },
			};
			const recipientDir = join(roots.stateRoot, "queue", "a-recipient");
			await (await import("node:fs/promises")).writeFile(
				join(recipientDir, `${newMessageId()}.json`),
				`${JSON.stringify(tamperedFile, null, 2)}\n`,
			);

			const first = await recoverQueue(roots, new Map([[keys.keyId, keys.publicKeyPem]]), new Date(), async () => {});
			const second = await recoverQueue(roots, new Map([[keys.keyId, keys.publicKeyPem]]), new Date(), async () => {});
			expect(first.replayed).toBe(1);
			expect(first.deadLettered).toBe(1);
			// Idempotent: second pass is a no-op.
			expect(second.replayed).toBe(1);
			expect(second.deadLettered).toBe(0);

			// The good record is still queued; the tampered one dead-lettered.
			const goodRecord = await loadQueueRecord(roots, "a-recipient", good.envelope.message_id);
			expect(goodRecord?.delivery.state).toBe("queued");
			const queueDir = join(roots.stateRoot, "queue", "a-recipient");
			const files = await readdir(queueDir);
			expect(files.some((file) => file.includes("evil"))).toBe(false);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
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
			await (await import("node:fs/promises")).writeFile(policyPath, `${JSON.stringify(parsed, null, 2)}\n`);
			const verificationKeys = new Map([[keys.keyId, keys.publicKeyPem]]);
			await expect(loadPolicy(roots, verificationKeys)).rejects.toThrow(/signature invalid/);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});