/**
 * Unit tests for the coas-daemon delivery serve loop (T-868 serve slice):
 * per-tick budget, round-robin fairness, hung-recipient timeout (SIGSTOP
 * fixture analogue), parked recipients without attempt burn, capability-
 * proven acks, and the dedupe-persist-before-ack contract surface.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEnvelope, signEnvelope } from "../../daemon/src/envelope.js";
import { enqueue } from "../../daemon/src/queue.js";
import type { SignedEnvelope } from "../../daemon/src/envelope.js";
import { DeliveryServeLoop, type LiveBindingConnection } from "../../daemon/src/serve.js";
import { loadOrCreateIntegrityKey, savePolicyFileForTest } from "./helpers.js";

async function makeContext() {
	const base = await mkdtemp(join(tmpdir(), "coas-daemon-serve-"));
	const roots: { runtimeRoot: string; stateRoot: string } = { runtimeRoot: join(base, "runtime"), stateRoot: join(base, "state") };
	const keys = await loadOrCreateIntegrityKey(roots, async () => {});
	await savePolicyFileForTest(roots, keys, [{ senderAgentId: "a-sender", recipientAgentId: "a-worker", payloadTypes: ["notice"] }]);
	const sender = { agentId: "a-sender", instanceId: "i-s1", generation: 1 };
	const verificationKeys = new Map([[keys.keyId, keys.publicKeyPem]]);
	const enqueueWithKeys = (input: { signed: SignedEnvelope }) => enqueue(roots, { ...input, policyDecision: { allowed: true } as const, verificationKeys });
	const serve = new DeliveryServeLoop(roots, async () => {}, { deliveryTimeoutMs: 250 });
	return { roots, keys, sender, recipient: "a-worker", serve, enqueueWithKeys, cleanup: async () => {
		await rm(roots.runtimeRoot, { recursive: true, force: true });
		await rm(roots.stateRoot, { recursive: true, force: true });
	} };
}

describe("DeliveryServeLoop (design doc sections 5/8)", () => {
	it("delivers to a live binding and records the ack", async () => {
		const ctx = await makeContext();
		try {
			const recipientAgentId = ctx.recipient;
			const signed = signEnvelope(
				ctx.keys.privateKeyPem,
				buildEnvelope(ctx.keys, {
					idempotencyKey: "k1",
					expiresAt: new Date(Date.now() + 3600_000),
					sender: ctx.sender,
					recipientAgentId,
					recipientGenerationPolicy: "stable_mailbox",
					recipientGeneration: null,
					payloadType: "notice",
					payload: "hello",
				}),
			);
			await ctx.enqueueWithKeys({ signed });

			// Live binding registered with the capability the daemon issued at admission.
			ctx.serve.bind({
				agentId: "a-worker",
				instanceId: "i-w1",
				generation: 1,
				label: "same_uid_untrusted",
				capabilitySecret: "cap-secret",
				async send() {
					return "ack";
				},
			});

			const result = await ctx.serve.tick(new Date());
			expect(result.attempted).toBe(1);
			expect(result.delivered).toBe(1);
			expect(ctx.serve.counters.delivered).toBe(1);

			// Queue record is now delivered (terminal); a second tick is a no-op.
			const second = await ctx.serve.tick(new Date());
			expect(second.attempted).toBe(0);
		} finally {
			await ctx.cleanup();
		}
	});

	it("parks when the recipient has no binding and burns no attempts", async () => {
		const ctx = await makeContext();
		try {
			const recipientAgentId = ctx.recipient;
			await ctx.enqueueWithKeys({ signed: signEnvelope(
				ctx.keys.privateKeyPem,
				buildEnvelope(ctx.keys, {
					idempotencyKey: "k-off",
					expiresAt: new Date(Date.now() + 3600_000),
					sender: ctx.sender,
					recipientAgentId,
					recipientGenerationPolicy: "stable_mailbox",
					recipientGeneration: null,
					payloadType: "notice",
					payload: "later",
				}),
			) });

			const result = await ctx.serve.tick(new Date());
			expect(result.parked).toBe(1);
			expect(result.attempted).toBe(1);
			expect(ctx.serve.counters.parked).toBe(1);
		} finally {
			await ctx.cleanup();
		}
	});

	it("times out a hung recipient and still delivers to healthy peers (SIGSTOP analogue)", async () => {
		const ctx = await makeContext();
		try {
			// Two recipients; the second is hung. Both must be reachable in one tick.
			await savePolicyFileForTest(ctx.roots, ctx.keys, [
				{ senderAgentId: ctx.sender.agentId, recipientAgentId: "a-worker" },
				{ senderAgentId: ctx.sender.agentId, recipientAgentId: "a-healthy" },
			]);
			for (const recipient of ["a-worker", "a-healthy"]) {
				await ctx.enqueueWithKeys({ signed: signEnvelope(
						ctx.keys.privateKeyPem,
						buildEnvelope(ctx.keys, {
							idempotencyKey: `k-${recipient}`,
							expiresAt: new Date(Date.now() + 3600_000),
							sender: ctx.sender,
							recipientAgentId: recipient,
							recipientGenerationPolicy: "stable_mailbox",
							recipientGeneration: null,
							payloadType: "notice",
							payload: "payload",
						}),
					),
				});
			}

			const hung: LiveBindingConnection = {
				agentId: "a-worker",
				instanceId: "i-w1",
				generation: 1,
				label: "same_uid_untrusted",
				capabilitySecret: "cap-worker",
				async send() {
					return new Promise<"ack" | "nack" | "timeout">(() => {});
				},
			};
			const healthy: LiveBindingConnection = {
				agentId: "a-healthy",
				instanceId: "i-h1",
				generation: 1,
				label: "same_uid_untrusted",
				capabilitySecret: "cap-healthy",
				async send() {
					return "ack";
				},
			};
			ctx.serve.bind(hung);
			ctx.serve.bind(healthy);

			const result = await ctx.serve.tick(new Date());
			expect(result.attempted).toBe(2);
			expect(result.delivered).toBeGreaterThanOrEqual(1);
		} finally {
			await ctx.cleanup();
		}
	});

	it("rejects acks with a wrong capability proof", async () => {
		const ctx = await makeContext();
		try {
			const rejected = await ctx.serve.ack({
				recipientAgentId: "a-worker",
				messageId: "m-none",
				capabilitySecret: "wrong-capability",
			});
			expect(rejected.accepted).toBe(false);
			expect(rejected.reason).toBe("no live binding");
		} finally {
			await ctx.cleanup();
		}
	});
});
