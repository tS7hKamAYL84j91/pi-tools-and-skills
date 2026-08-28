/**
 * Unit tests for the coas-daemon registry slice (T-870 slice 1): M3
 * one-live-binding admission, M2 crash re-admission with bounded respawn
 * backoff, M6 sequenced snapshot/change-events with client overlap rules,
 * spawn persistence with generation continuity across restarts.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonRegistry, RegistryEventBuffer, respawnBackoffMs, type RegistryEvent, type RegistryKeys, type SpawnRequest } from "../../daemon/src/registry.js";
import { loadOrCreateIntegrityKey } from "../../daemon/src/keys.js";
import type { DaemonRoots } from "../../daemon/src/paths.js";

async function makeRoots(): Promise<DaemonRoots> {
	const base = await mkdtemp(join(tmpdir(), "coas-daemon-reg-"));
	return { runtimeRoot: join(base, "runtime"), stateRoot: join(base, "state") };
}

async function makeKeys(roots: DaemonRoots): Promise<RegistryKeys> {
	const keys = await loadOrCreateIntegrityKey(roots, async () => {});
	return { keyId: keys.keyId, privateKeyPem: keys.privateKeyPem, publicKeyPem: keys.publicKeyPem };
}

/** Deterministic clock for backoff/drain timing assertions. */
function makeClock(startMs = 1_000_000): { now: () => Date; advance: (ms: number) => void } {
	let current = startMs;
	return {
		now: (): Date => new Date(current),
		advance: (ms: number): void => {
			current += ms;
		},
	};
}

function collector(): { events: Record<string, unknown>[]; sink: (event: Record<string, unknown>) => Promise<void> } {
	const events: Record<string, unknown>[] = [];
	return { events, sink: async (event: Record<string, unknown>): Promise<void> => { events.push(event); } };
}

const ROOT_SPAWN: SpawnRequest = { displayName: "worker", parentId: null, visibility: "workspace", scope: "root" };

/** Positive-narrowing helper: the union discriminates on the `admitted` literal. */
function assertAdmitted(result: Awaited<ReturnType<DaemonRegistry["admit"]>>): Extract<typeof result, { admitted: true }> {
	if (result.admitted !== true) throw new Error("expected admission, got rejection");
	return result;
}

/** Register + admit one agent on the given registry; returns the agent id. */
async function admitOne(registry: DaemonRegistry, spawn: SpawnRequest = ROOT_SPAWN): Promise<string> {
	const identity = await registry.registerAgent(spawn);
	await registry.admit(identity.agentId);
	return identity.agentId;
}

describe("spawn persistence (ADR-0018 implementation path item 3)", () => {
	it("mints a stable opaque agent_id, admits a capability-bound instance, and persists durably", async () => {
		const roots = await makeRoots();
		try {
			const keys = await makeKeys(roots);
			const registry = new DaemonRegistry(roots, keys, {});
			const identity = await registry.registerAgent(ROOT_SPAWN);

			// agent_id is opaque and never derived from the display name.
			expect(identity.agentId).toMatch(/^a-[0-9a-f-]{36}$/);
			expect(identity.agentId).not.toContain(ROOT_SPAWN.displayName);
			expect(identity.scope).toBe("root");
			expect(identity.parentId).toBeNull();

			const result = assertAdmitted(await registry.admit(identity.agentId));
			expect(result.generation).toBe(2);
			expect(result.capabilitySecret).toHaveLength(44);

			// Durable identity record: generation bumped, live instance attached.
			const raw = await readFile(join(roots.stateRoot, "registry", "identities", `${identity.agentId}.json`), "utf8");
			const record = JSON.parse(raw) as { generation: number; liveInstanceId: string; scope: string };
			expect(record.generation).toBe(2);
			expect(record.liveInstanceId).toBe(result.instanceId);
			expect(record.scope).toBe("root");

			// Registry-derived ADR-0008 guard inputs (design doc section 5a).
			expect(registry.guardInputsFor(identity.agentId)).toEqual({ parentId: null, visibility: "workspace", scope: "root" });
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("name reuse mints a new agent_id with no rebinding of the predecessor (ADR section 5)", async () => {
		const roots = await makeRoots();
		try {
			const keys = await makeKeys(roots);
			const registry = new DaemonRegistry(roots, keys, {});
			const first = await registry.registerAgent(ROOT_SPAWN);
			const second = await registry.registerAgent(ROOT_SPAWN);
			expect(second.agentId).not.toBe(first.agentId);
			expect(second.generation).toBe(1);
			expect((await registry.snapshot()).entries).toHaveLength(2);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});

describe("M3 one-live-binding (latest authenticated admission wins)", () => {
	it("supersedes the previous instance with an audited notice and abort hook, no fan-out", async () => {
		const roots = await makeRoots();
		try {
			const keys = await makeKeys(roots);
			const notices: { agentId: string; instanceId: string; generation: number; reason: string }[] = [];
			const audit = collector();
			const registry = new DaemonRegistry(roots, keys, { notify: (notice) => notices.push(notice), audit: audit.sink });

			const identity = await registry.registerAgent(ROOT_SPAWN);
			const first = assertAdmitted(await registry.admit(identity.agentId));
			const second = assertAdmitted(await registry.admit(identity.agentId));

			// Latest wins; the loser is reported for its visible notice.
			expect(second.generation).toBe(first.generation + 1);
			expect(second.superseded).toEqual({ instanceId: first.instanceId, generation: first.generation });
			expect(notices).toEqual([{ agentId: identity.agentId, instanceId: first.instanceId, generation: first.generation, reason: "superseded" }]);

			// Exactly one live binding per agent_id (fan-out does not exist).
			const snapshot = await registry.snapshot();
			const entries = snapshot.entries.filter((entry) => entry.agentId === identity.agentId);
			expect(entries).toHaveLength(1);
			expect(entries[0]?.liveInstanceId).toBe(second.instanceId);

			// Binding resolution and ack material come from the winner only.
			expect(registry.bindingFor(identity.agentId)?.instanceId).toBe(second.instanceId);
			expect(registry.capabilityFor(identity.agentId)?.capabilitySecret).toBe(second.capabilitySecret);

			const invalidations = audit.events.filter((event) => event.kind === "instance_invalidated");
			expect(invalidations).toHaveLength(1);
			expect(invalidations[0]).toMatchObject({ agentId: identity.agentId, instanceId: first.instanceId, reason: "superseded" });
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("superseding one agent never touches another agent's binding", async () => {
		const roots = await makeRoots();
		try {
			const keys = await makeKeys(roots);
			const registry = new DaemonRegistry(roots, keys, {});
			const a = await registry.registerAgent({ ...ROOT_SPAWN, displayName: "agent-a" });
			const b = await registry.registerAgent({ ...ROOT_SPAWN, displayName: "agent-b" });
			await registry.admit(a.agentId);
			const bFirst = assertAdmitted(await registry.admit(b.agentId));
			await registry.admit(a.agentId);

			expect(registry.bindingFor(b.agentId)?.instanceId).toBe(bFirst.instanceId);
			expect(registry.bindingFor(b.agentId)?.generation).toBe(bFirst.generation);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("refuses admission for an unregistered agent (fail-closed)", async () => {
		const roots = await makeRoots();
		try {
			const keys = await makeKeys(roots);
			const registry = new DaemonRegistry(roots, keys, {});
			await expect(registry.admit("a-unknown")).rejects.toThrow(/register before admitting/);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});

describe("M2 supervision: crash re-admission as a new generation", () => {
	it("a crash invalidates the binding and arms bounded respawn backoff; re-admission bumps generation", async () => {
		const roots = await makeRoots();
		try {
			const keys = await makeKeys(roots);
			const clock = makeClock();
			const audit = collector();
			const registry = new DaemonRegistry(roots, keys, { now: clock.now, audit: audit.sink });
			const agentId = await admitOne(registry);

			const instanceId = registry.bindingFor(agentId)?.instanceId ?? "missing";
			const crash = await registry.noteInstanceCrash(agentId, instanceId);
			expect(crash.recorded).toBe(true);
			expect(crash.backoffMs).toBe(1_000);

			// Never silently respawned in place: an immediate re-admission is
			// refused until the bounded backoff elapses.
			const early = await registry.admit(agentId);
			if (early.admitted) throw new Error("expected rejection during backoff");
			expect(early.retryAfterMs).toBeGreaterThan(0);
			expect(registry.bindingFor(agentId)).toBeUndefined();

			clock.advance(1_001);
			const reAdmitted = assertAdmitted(await registry.admit(agentId));
			expect(reAdmitted.generation).toBe(3);

			expect(audit.events.filter((event) => event.kind === "instance_crashed")).toHaveLength(1);
			expect(audit.events.filter((event) => event.kind === "admission_rejected")).toHaveLength(1);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("escalates 1s→2s→…→60s cap across rapid crash loops, and resets on stability", async () => {
		const roots = await makeRoots();
		try {
			const keys = await makeKeys(roots);
			const clock = makeClock();
			const registry = new DaemonRegistry(roots, keys, { now: clock.now });
			const agentId = await admitOne(registry);

			let previousGeneration = 2;
			const expectedLadder = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000];
			for (const expectedBackoff of expectedLadder) {
				const instanceId = registry.bindingFor(agentId)?.instanceId ?? "missing";
				const crash = await registry.noteInstanceCrash(agentId, instanceId);
				expect(crash.backoffMs).toBe(expectedBackoff);
				// Wait out the backoff; the replacement is a new generation.
				clock.advance(expectedBackoff + 1);
				const admitted = assertAdmitted(await registry.admit(agentId));
				expect(admitted.generation).toBe(previousGeneration + 1);
				previousGeneration = admitted.generation;
			}

			// A crash after a stable lifetime resets the ladder to 1s.
			clock.advance(60_001);
			const stableCrash = await registry.noteInstanceCrash(agentId, registry.bindingFor(agentId)?.instanceId ?? "missing");
			expect(stableCrash.backoffMs).toBe(1_000);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("a crash notice for an already-superseded instance is a no-op", async () => {
		const roots = await makeRoots();
		try {
			const keys = await makeKeys(roots);
			const registry = new DaemonRegistry(roots, keys, {});
			const identity = await registry.registerAgent(ROOT_SPAWN);
			const first = assertAdmitted(await registry.admit(identity.agentId));
			await registry.admit(identity.agentId);

			const stale = await registry.noteInstanceCrash(identity.agentId, first.instanceId);
			expect(stale.recorded).toBe(false);
			expect(registry.bindingFor(identity.agentId)).toBeDefined();
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});

describe("M6 registry handoff: sequenced snapshot and change events", () => {
	it("emits monotonic events; the subscribe handshake sees snapshot + later events with no gap", async () => {
		const roots = await makeRoots();
		try {
			const keys = await makeKeys(roots);
			const registry = new DaemonRegistry(roots, keys, {});

			// Pre-subscribe mutation lands in the snapshot, not the listener.
			const identity = await registry.registerAgent(ROOT_SPAWN);
			const received: RegistryEvent[] = [];
			const handshake = await registry.subscribe((event) => received.push(event));
			expect(handshake.snapshot.entries).toHaveLength(1);

			const admitted = assertAdmitted(await registry.admit(identity.agentId));
			const crashed = await registry.noteInstanceCrash(identity.agentId, admitted.instanceId);
			expect(crashed.recorded).toBe(true);

			expect(received.map((event) => event.kind)).toEqual(["instance_admitted", "instance_invalidated"]);
			const seqs = received.map((event) => event.seq);
			expect((seqs[1] ?? 0) - (seqs[0] ?? 0)).toBe(1);
			expect(handshake.snapshot.seq).toBeLessThan(seqs[0] ?? 0);

			const after = await registry.snapshot();
			expect(after.seq).toBe(seqs[1]);
			expect(after.entries[0]?.liveInstanceId).toBeUndefined();

			handshake.unsubscribe();
			await registry.registerAgent({ ...ROOT_SPAWN, displayName: "after-unsubscribe" });
			expect(received).toHaveLength(2);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("a concurrent snapshot serializes behind an in-flight admission (single-lock atomic read)", async () => {
		const roots = await makeRoots();
		try {
			const keys = await makeKeys(roots);
			const registry = new DaemonRegistry(roots, keys, {});
			const identity = await registry.registerAgent(ROOT_SPAWN);

			const admission = registry.admit(identity.agentId);
			const concurrent = await registry.snapshot();
			const admitted = assertAdmitted(await admission);

			// The snapshot waited for the mutation: never a torn view.
			const entry = concurrent.entries.find((candidate) => candidate.agentId === identity.agentId);
			expect(entry?.liveInstanceId).toBe(admitted.instanceId);
			expect(concurrent.seq).toBeGreaterThanOrEqual(2);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});

describe("M6 client overlap rules (design doc section 7, formal review F7)", () => {
	const mkEvent = (seq: number, kind: RegistryEvent["kind"]): RegistryEvent => ({ seq, at: "t", kind, agentId: "a-1" });

	it("buffers events until the snapshot, drops seq <= snapshot, applies in order after", () => {
		const buffer = new RegistryEventBuffer();

		expect(buffer.applyEvent(mkEvent(1, "identity_created"))).toBe("buffered");
		expect(buffer.applyEvent(mkEvent(2, "instance_admitted"))).toBe("buffered");

		const reconciled = buffer.applySnapshot({ seq: 5, generatedAt: "t", entries: [] });
		// Events 1 and 2 are already contained in the snapshot: dropped.
		expect(reconciled.dropped).toBe(2);
		expect(buffer.resyncRequired).toBe(false);

		expect(buffer.applyEvent(mkEvent(6, "instance_admitted"))).toBe("applied");
		expect(buffer.applyEvent(mkEvent(7, "instance_invalidated"))).toBe("applied");
		expect(buffer.applied.map((event) => event.seq)).toEqual([6, 7]);

		// Old/duplicate events are dropped; only a true gap triggers resync.
		expect(buffer.applyEvent(mkEvent(6, "instance_admitted"))).toBe("dropped");
		expect(buffer.resyncRequired).toBe(false);
		expect(buffer.applyEvent(mkEvent(9, "instance_admitted"))).toBe("resync");
		expect(buffer.resyncRequired).toBe(true);

		// A fresh snapshot re-arms the client.
		expect(buffer.applySnapshot({ seq: 9, generatedAt: "t", entries: [] }).dropped).toBe(0);
		expect(buffer.resyncRequired).toBe(false);
	});

	it("a buffered event beyond the snapshot seq leaves a resync requirement", () => {
		const buffer = new RegistryEventBuffer();
		buffer.applyEvent(mkEvent(3, "instance_admitted"));
		buffer.applyEvent(mkEvent(9, "instance_admitted"));
		const reconciled = buffer.applySnapshot({ seq: 5, generatedAt: "t", entries: [] });
		// Event 3 is contained (dropped); event 9 skips expected 6: true gap.
		expect(reconciled.dropped).toBe(1);
		expect(buffer.resyncRequired).toBe(true);
	});

	it("the backoff ladder helper is monotonic and capped", () => {
		expect(respawnBackoffMs(1)).toBe(1_000);
		expect(respawnBackoffMs(2)).toBe(2_000);
		expect(respawnBackoffMs(7)).toBe(60_000);
		expect(respawnBackoffMs(50)).toBe(60_000);
	});
});

describe("recovery: generation continuity across restarts (ADR section 7)", () => {
	it("rebuilds identities, invalidates stale live bindings, keeps generations", async () => {
		const roots = await makeRoots();
		try {
			const keys = await makeKeys(roots);
			const before = new DaemonRegistry(roots, keys, {});
			const identity = await before.registerAgent(ROOT_SPAWN);
			await before.admit(identity.agentId);

			const after = await DaemonRegistry.recover(roots, keys, {});
			// Live bindings never survive a restart (stale live-instance records
			// are untrusted, ADR section 2); identity and generation do survive.
			expect(after.bindingFor(identity.agentId)).toBeUndefined();
			const entry = (await after.snapshot()).entries.find((candidate) => candidate.agentId === identity.agentId);
			expect(entry?.generation).toBe(2);
			expect(entry?.liveInstanceId).toBeUndefined();
			expect(entry?.scope).toBe("root");
			const raw = await readFile(join(roots.stateRoot, "registry", "identities", `${identity.agentId}.json`), "utf8");
			expect(raw).not.toContain("liveInstanceId");
			expect(after.eventLog().some((event) => event.kind === "instance_invalidated" && event.reason === "restart_stale")).toBe(true);

			// Re-admission continues the generation sequence.
			const reAdmitted = assertAdmitted(await after.admit(identity.agentId));
			expect(reAdmitted.generation).toBe(3);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("replaying recovery is a no-op (idempotent)", async () => {
		const roots = await makeRoots();
		try {
			const keys = await makeKeys(roots);
			const first = new DaemonRegistry(roots, keys, {});
			const identity = await first.registerAgent(ROOT_SPAWN);
			await first.admit(identity.agentId);

			const second = await DaemonRegistry.recover(roots, keys, {});
			expect(second.eventLog().filter((event) => event.kind === "instance_invalidated" && event.reason === "restart_stale")).toHaveLength(1);

			const third = await DaemonRegistry.recover(roots, keys, {});
			expect(third.eventLog().filter((event) => event.kind === "instance_invalidated" && event.reason === "restart_stale")).toHaveLength(0);
			const entry = (await third.snapshot()).entries.find((candidate) => candidate.agentId === identity.agentId);
			expect(entry?.generation).toBe(2);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("a tampered identity record is quarantined, never trusted, never dropped silently", async () => {
		const roots = await makeRoots();
		try {
			const keys = await makeKeys(roots);
			const registry = new DaemonRegistry(roots, keys, {});
			const identity = await registry.registerAgent(ROOT_SPAWN);
			const path = join(roots.stateRoot, "registry", "identities", `${identity.agentId}.json`);
			const original = await readFile(path, "utf8");
			const tampered = original.replace(/"signature": "[^"]+"/, '"signature": "AAAA"');
			expect(tampered).not.toBe(original);
			await writeFile(path, tampered, "utf8");

			const recovered = await DaemonRegistry.recover(roots, keys, {});
			expect((await recovered.snapshot()).entries).toHaveLength(0);
			const quarantine = await readdir(join(roots.stateRoot, "queue", "quarantine"));
			expect(quarantine.length).toBe(1);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});

describe("M2 pi-close drain (bounded grace, then abort)", () => {
	it("spares clean exits during the grace and aborts the remainder at the deadline", async () => {
		const roots = await makeRoots();
		try {
			const keys = await makeKeys(roots);
			const clock = makeClock();
			const notices: { agentId: string; reason: string }[] = [];
			const registry = new DaemonRegistry(roots, keys, { now: clock.now, notify: (notice) => notices.push(notice) });
			const a = await registry.registerAgent({ ...ROOT_SPAWN, displayName: "agent-a" });
			const b = await registry.registerAgent({ ...ROOT_SPAWN, displayName: "agent-b" });
			const aAdmitted = assertAdmitted(await registry.admit(a.agentId));
			await registry.admit(b.agentId);

			const drain = registry.drainForClose(30);
			// agent-a exits cleanly during the grace; agent-b hangs mid-turn.
			await new Promise((resolve) => setTimeout(resolve, 5));
			await registry.unbind(a.agentId, aAdmitted.instanceId);
			const result = await drain;

			expect(result.drained).toEqual([a.agentId]);
			expect(result.aborted).toEqual([b.agentId]);
			expect(notices).toHaveLength(1);
			expect(notices[0]?.agentId).toBe(b.agentId);
			expect(notices[0]?.reason).toBe("close_drain_expired");
			expect(registry.bindingFor(a.agentId)).toBeUndefined();
			expect(registry.bindingFor(b.agentId)).toBeUndefined();
		} finally {
			await rm(roots.runtimeRoot, { recursive: true, force: true });
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("admissions during the drain grace proceed and are not captured by the deadline", async () => {
		const roots = await makeRoots();
		try {
			const keys = await makeKeys(roots);
			const clock = makeClock();
			const registry = new DaemonRegistry(roots, keys, { now: clock.now });
			const existing = await registry.registerAgent(ROOT_SPAWN);
			await registry.admit(existing.agentId);

			const drain = registry.drainForClose(25);
			await new Promise((resolve) => setTimeout(resolve, 5));
			const late = await registry.registerAgent({ ...ROOT_SPAWN, displayName: "late-joiner" });
			const lateAdmission = assertAdmitted(await registry.admit(late.agentId));

			const result = await drain;
			expect(result.aborted).toEqual([existing.agentId]);
			// The late joiner has no in-flight turn: not aborted.
			expect(registry.bindingFor(late.agentId)?.instanceId).toBe(lateAdmission.instanceId);
		} finally {
			await rm(roots.runtimeRoot, { recursive: true, force: true });
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});