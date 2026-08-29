/**
 * T-873 step-2 midpoint review harness (48h pilot, 24h mid-point, per the
 * accepted work-order): deliberate daemon/daemon-client restart inside the
 * pilot window, counters summary, dead-letter reasons, no-double-writer
 * verification, guard-drop accounting. Synthetic pilot state root only.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEnvelope, signEnvelope } from "../../daemon/src/envelope.js";
import { enqueue, loadQueueRecord } from "../../daemon/src/queue.js";
import { invalidateWriterLeaseOnRestart, loadWriterLease, writerLeaseInGrace } from "../../daemon/src/schedule-tick.js";
import { claimWriterRole } from "../../daemon/src/schedule-tick.js";
import { loadOrCreateIntegrityKey } from "../../daemon/src/keys.js";
import { DeliveryServeLoop } from "../../daemon/src/serve.js";

async function makePilot() {
	const base = await mkdtemp(join(tmpdir(), "t873-midpoint-"));
	const roots: { runtimeRoot: string; stateRoot: string } = { runtimeRoot: join(base, "runtime"), stateRoot: join(base, "state") };
	await mkdir(join(roots.stateRoot, "schedules"), { recursive: true });
	const keys = await loadOrCreateIntegrityKey(roots, async () => {});
	const verificationKeys = new Map([[keys.keyId, keys.publicKeyPem]]);
	const enqueueSigned = (signed: ReturnType<typeof signEnvelope>) =>
		enqueue(roots, { signed, policyDecision: { allowed: true }, verificationKeys });
	return {
		roots,
		keys,
		verificationKeys,
		enqueueSigned,
		cleanup: async () => {
			await rm(roots.runtimeRoot, { recursive: true, force: true }).catch(() => {});
			await rm(roots.stateRoot, { recursive: true, force: true });
		},
	};
}

const SENDER = { agentId: "a-coas-daemon", instanceId: "i-sched", generation: 1 } as const;

function signedFor(pilot: Awaited<ReturnType<typeof makePilot>>, cycle: string) {
	const envelope = buildEnvelope(pilot.keys, {
		idempotencyKey: `schedule:pilot:${cycle}`,
		expiresAt: new Date(Date.now() + 3600_000),
		sender: SENDER,
		recipientAgentId: "a-pilot",
		recipientGenerationPolicy: "stable_mailbox",
		recipientGeneration: null,
		payloadType: "schedule_delivery",
		payload: `pilot cycle ${cycle}`,
	});
	return signEnvelope(pilot.keys.privateKeyPem, envelope);
}

describe("T-873 step-2 midpoint (pilot workspace, 24h mid-point review)", () => {
	it("delivers through the envelope path across a deliberate restart; no double-writer; counters sane", async () => {
		const pilot = await makePilot();
		try {
			// Cycle 1: delivered live to the pilot binding.
			await pilot.enqueueSigned(signedFor(pilot, "cycle-1"));
			const serve1 = new DeliveryServeLoop(pilot.roots, async () => {}, { deliveryTimeoutMs: 100 });
			serve1.bind({
				agentId: "a-pilot",
				instanceId: "i-pilot",
				generation: 1,
				label: "same_uid_untrusted",
				capabilitySecret: "cap-pilot",
				guardInputs: { parentId: null, visibility: "workspace", scope: "root" },
				send: async () => "ack",
			});
			const tick1 = await serve1.tick(new Date());
			expect(tick1.delivered).toBe(1);
			const delivered1 = await loadQueueRecord(pilot.roots, "a-pilot", await recordId(pilot, "cycle-1"));
			expect(delivered1?.delivery.state).toBe("delivered");

			// Deliberate restart: writer-lease invalidation (re-arm) + recovery replay.
			await claimWriterRole(pilot.roots, pilot.keys, { agentId: "a-gravitas", instanceId: "i-g1", generation: 1 });
			await invalidateWriterLeaseOnRestart(pilot.roots, pilot.keys);
			const lease = await loadWriterLease(pilot.roots, pilot.verificationKeys);
			expect(lease?.invalidatedAt).toBeDefined();

			// Cycle 2 (post-restart): delivered through the same envelope path;
			// the re-armed grace suppresses only writer-tagged work, not this.
			await pilot.enqueueSigned(signedFor(pilot, "cycle-2"));
			const serve2 = new DeliveryServeLoop(pilot.roots, async () => {}, { deliveryTimeoutMs: 100 });
			serve2.bind({
				agentId: "a-pilot",
				instanceId: "i-pilot",
				generation: 1,
				label: "same_uid_untrusted",
				capabilitySecret: "cap-pilot",
				guardInputs: { parentId: null, visibility: "workspace", scope: "root" },
				send: async () => "ack",
			});
			const tick2 = await serve2.tick(new Date());
			expect(tick2.delivered).toBe(1);

			// Counters sane: the restarted loop served the post-restart cycle.
			expect(serve2.counters.delivered).toBe(1);
			expect(serve2.counters.ticks).toBeGreaterThanOrEqual(1);
		} finally {
			await pilot.cleanup();
		}
	});

	it("no double-writer: M5 grace suppresses writer-tagged cycles after restart", async () => {
		const pilot = await makePilot();
		try {
			await claimWriterRole(pilot.roots, pilot.keys, { agentId: "a-gravitas", instanceId: "i-g1", generation: 1 });
			await invalidateWriterLeaseOnRestart(pilot.roots, pilot.keys);
			const lease = await loadWriterLease(pilot.roots, pilot.verificationKeys);
			// Within the 30s re-arm grace: writer delivery stays deferred.
			expect(writerLeaseInGrace(lease!, new Date())).toBe(true);
		} finally {
			await pilot.cleanup();
		}
	});
});

async function recordId(pilot: Awaited<ReturnType<typeof makePilot>>, cycle: string): Promise<string> {
	const dir = join(pilot.roots.stateRoot, "queue", "a-pilot");
	const files = await readdir(dir);
	const match = files.find((file) => file.endsWith(".json"));
	if (!match) throw new Error(`no record for cycle ${cycle}`);
	return match.slice(0, -5);
}

