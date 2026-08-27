/**
 * Unit tests for the coas-daemon core slice (T-867): durable fsync writes,
 * single-instance lock, and signed identity records.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireSingleInstanceLock, releaseSingleInstanceLock } from "../../daemon/src/lock.js";
import { sweepStaleTmp, writeDurableFileNoReplace, writeDurableFileReplace } from "../../daemon/src/durable-fs.js";
import { createIdentity, admitNewInstance, loadIdentity } from "../../daemon/src/identity.js";
import { loadOrCreateIntegrityKey } from "../../daemon/src/keys.js";
import type { DaemonRoots } from "../../daemon/src/paths.js";

async function makeRoots(): Promise<DaemonRoots> {
	const base = await mkdtemp(join(tmpdir(), "coas-daemon-test-"));
	return { runtimeRoot: join(base, "runtime"), stateRoot: join(base, "state") };
}

const auditEvents: Record<string, unknown>[] = [];
const auditSink = async (event: Record<string, unknown>): Promise<void> => {
	auditEvents.push(event);
};

describe("durable fs writes (design doc section 3)", () => {
	it("publishes with no-replace semantics and fsyncs the directory", async () => {
		const roots = await makeRoots();
		try {
			const target = join(roots.stateRoot, "registry", "identities", "a-test.json");
			const result = await writeDurableFileNoReplace(target, '{"agentId":"a-test"}\n', 0o600, roots.stateRoot);
			expect(result.created).toBe(true);
			expect(await readFile(target, "utf8")).toContain("a-test");

			// No tmp residue after publication.
			const dirEntries = await readdir(join(roots.stateRoot, "registry", "identities"));
			expect(dirEntries.every((name) => !name.endsWith(".tmp"))).toBe(true);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("refuses a second no-replace publish of the same target", async () => {
		const roots = await makeRoots();
		try {
			const target = join(roots.stateRoot, "queue", "x", "m1.json");
			await writeDurableFileNoReplace(target, "one\n", 0o600, roots.stateRoot);
			await expect(writeDurableFileNoReplace(target, "two\n", 0o600, roots.stateRoot)).rejects.toThrow(/target exists/);
			expect(await readFile(target, "utf8")).toBe("one\n");
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("recovery sweep redoes validated tmp->final renames and drops completed ones", async () => {
		const roots = await makeRoots();
		try {
			const dir = join(roots.stateRoot, "queue", "r");
			// Simulate an interrupted enqueue: valid tmp, no final.
			const orphanTmp = join(dir, `m-orphan.json.${process.pid}.00000000-0000-0000-0000-000000000000.tmp`);
			await writeDurableFileNoReplace(orphanTmp, "payload\n", 0o600, roots.stateRoot);
			// Simulate a completed publication: tmp + final both present.
			const doneTmp = join(dir, `m-done.json.${process.pid}.00000000-0000-0000-0000-000000000001.tmp`);
			await writeDurableFileNoReplace(doneTmp, "payload\n", 0o600, roots.stateRoot);
			await writeDurableFileNoReplace(join(dir, "m-done.json"), "payload\n", 0o600, roots.stateRoot);

			const { swept } = await sweepStaleTmp(dir, roots.stateRoot);
			expect(swept.length).toBe(2);
			expect(await readFile(join(dir, "m-orphan.json"), "utf8")).toBe("payload\n");
			const names = await readdir(dir);
			expect(names.every((name) => !name.endsWith(".tmp"))).toBe(true);
			expect(names).toContain("m-done.json");
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("replace variant updates content durably", async () => {
		const roots = await makeRoots();
		try {
			const target = join(roots.stateRoot, "registry", "identities", "a-up.json");
			await writeDurableFileReplace(target, "v1\n", 0o600, roots.stateRoot);
			await writeDurableFileReplace(target, "v2\n", 0o600, roots.stateRoot);
			expect(await readFile(target, "utf8")).toBe("v2\n");
			const info = await stat(target);
			expect(info.isFile()).toBe(true);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});

describe("single-instance lock (ADR section 7)", () => {
	it("second live instance fails closed", async () => {
		const roots = await makeRoots();
		try {
			const first = await acquireSingleInstanceLock(roots);
			expect(first.acquired).toBe(true);
			const second = await acquireSingleInstanceLock(roots);
			expect(second.acquired).toBe(false);
			expect(second.liveHolderPid).toBe(process.pid);
		} finally {
			await releaseSingleInstanceLock(roots);
			await rm(roots.runtimeRoot, { recursive: true, force: true });
		}
	});

	it("a dead holder's lock is verifiably released (takeover)", async () => {
		const roots = await makeRoots();
		try {
			const first = await acquireSingleInstanceLock(roots);
			expect(first.acquired).toBe(true);
			await releaseSingleInstanceLock(roots);
			const second = await acquireSingleInstanceLock(roots);
			expect(second.acquired).toBe(true);
		} finally {
			await releaseSingleInstanceLock(roots);
			await rm(roots.runtimeRoot, { recursive: true, force: true });
		}
	});

	it("release is holder-only", async () => {
		const roots = await makeRoots();
		try {
			await acquireSingleInstanceLock(roots);
			// Simulate a different holder by rewriting the lock pid.
			const lockPath = join(roots.runtimeRoot, "daemon.lock");
			await writeDurableFileReplace(lockPath, `${JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }, null, 2)}\n`, 0o600, roots.runtimeRoot);
			expect(await releaseSingleInstanceLock(roots)).toBe(false);
		} finally {
			await releaseSingleInstanceLock(roots);
			await rm(roots.runtimeRoot, { recursive: true, force: true });
		}
	});
});

describe("identity records (ADR section 2, section 8 signing)", () => {
	it("creates, loads, and verifies a signed identity record", async () => {
		const roots = await makeRoots();
		try {
			const keys = await loadOrCreateIntegrityKey(roots, auditSink);
			const record = await createIdentity(roots, keys, { displayName: "gravitas" });
			expect(record.generation).toBe(1);
			expect(record.agentId).toMatch(/^a-/);

			const verificationKeys = new Map([[keys.keyId, keys.publicKeyPem]]);
			const loaded = await loadIdentity(roots, record.agentId, verificationKeys);
			expect(loaded?.displayName).toBe("gravitas");
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("rejects a tampered identity record", async () => {
		const roots = await makeRoots();
		try {
			const keys = await loadOrCreateIntegrityKey(roots, auditSink);
			const record = await createIdentity(roots, keys, { displayName: "worker" });
			const path = join(roots.stateRoot, "registry", "identities", `${record.agentId}.json`);
			const tampered = JSON.parse(await readFile(path, "utf8")) as { displayName: string; signature: string };
			tampered.displayName = "attacker";
			await writeDurableFileReplace(path, `${JSON.stringify(tampered, null, 2)}\n`, 0o600, roots.stateRoot);
			const verificationKeys = new Map([[keys.keyId, keys.publicKeyPem]]);
			await expect(loadIdentity(roots, record.agentId, verificationKeys)).rejects.toThrow(/signature invalid/);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("admission bumps generation and swaps the live instance id", async () => {
		const roots = await makeRoots();
		try {
			const keys = await loadOrCreateIntegrityKey(roots, auditSink);
			const record = await createIdentity(roots, keys, { displayName: "worker" });
			const first = await admitNewInstance(roots, keys, record);
			expect(first.record.generation).toBe(2);
			expect(first.instanceId).toMatch(/^i-/);
			const second = await admitNewInstance(roots, keys, first.record);
			expect(second.record.generation).toBe(3);
			expect(second.instanceId).not.toBe(first.instanceId);

			const verificationKeys = new Map([[keys.keyId, keys.publicKeyPem]]);
			const loaded = await loadIdentity(roots, record.agentId, verificationKeys);
			expect(loaded?.generation).toBe(3);
			expect(loaded?.liveInstanceId).toBe(second.instanceId);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});

describe("integrity key management (design doc section 9)", () => {
	it("emits the fallback audit event and publishes the verification key", async () => {
		const roots = await makeRoots();
		try {
			const events: Record<string, unknown>[] = [];
			const keys = await loadOrCreateIntegrityKey(roots, async (event) => {
				events.push(event);
			});
			expect(keys.fallbackFileUsed).toBe(true);
			expect(events.some((event) => event.kind === "key_fallback_file")).toBe(true);
			const pub = await stat(join(roots.stateRoot, "keys", "public", `${keys.keyId}.pub`));
			expect(pub.isFile()).toBe(true);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});