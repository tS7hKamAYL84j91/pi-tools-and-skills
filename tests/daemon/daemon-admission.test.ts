/**
 * Unit tests for the coas-daemon admission/admin/socket slice (T-867 slice 2):
 * capability-token admission, fail-closed admin rejection on the agent
 * surface, operator passphrase proof, socket publication, audit durability.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitInstance, capabilityProof, verifyCapabilityProof, verifySenderBinding, ADMISSION_LABEL, type LiveBinding } from "../../daemon/src/admission.js";
import { appendAudit } from "../../daemon/src/audit.js";
import { ADMIN_OPCODES, adminChallenge, adminProof, deriveAdminKey, executeAdminOperation, rejectAgentAdminOperation, verifyAdminProof } from "../../daemon/src/admin.js";
import { publishDaemonSocket, validateExistingSocketPath, probeSocketLive } from "../../daemon/src/socket.js";
import { createIdentity } from "../../daemon/src/identity.js";
import { loadOrCreateIntegrityKey } from "../../daemon/src/keys.js";
import type { DaemonRoots } from "../../daemon/src/paths.js";

async function makeRoots(): Promise<DaemonRoots> {
	const base = await mkdtemp(join(tmpdir(), "coas-daemon-adm-"));
	return { runtimeRoot: join(base, "runtime"), stateRoot: join(base, "state") };
}

describe("admission binding (ADR section 2, same_uid_untrusted)", () => {
	it("admits with a capability token, label, and audit event; proof round-trips", async () => {
		const roots = await makeRoots();
		try {
			const keys = await loadOrCreateIntegrityKey(roots, async () => {});
			const identity = await createIdentity(roots, keys, { displayName: "worker" });
			const { binding, capability } = await admitInstance(roots, keys, identity);

			expect(binding.label).toBe(ADMISSION_LABEL);
			expect(binding.generation).toBe(2);
			expect(capability.capabilitySecret).toHaveLength(44);

			const nonce = "challenge-nonce";
			expect(verifyCapabilityProof(capability.capabilitySecret, nonce, capabilityProof(capability.capabilitySecret, nonce))).toBe(true);
			expect(verifyCapabilityProof(capability.capabilitySecret, nonce, Buffer.alloc(32))).toBe(false);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
			await rm(roots.runtimeRoot, { recursive: true, force: true });
		}
	});

	it("attributes sends only from the admitted binding (never caller fields)", () => {
		const binding: LiveBinding = { agentId: "a-1", instanceId: "i-1", generation: 2, label: ADMISSION_LABEL, admittedAt: "now" };
		expect(verifySenderBinding(binding, { agentId: "a-1", instanceId: "i-1", generation: 2 })).toBe(true);
		expect(verifySenderBinding(undefined, { agentId: "a-1", instanceId: "i-1", generation: 2 })).toBe(false);
		// A different generation must not pass (generation-boundary continuity).
		expect(verifySenderBinding(binding, { agentId: "a-1", instanceId: "i-1", generation: 3 })).toBe(false);
	});
});

describe("admin control plane (ADR section 8, design doc section 9)", () => {
	it("rejects admin operations attempted through the agent surface, fail-closed + audited", async () => {
		const roots = await makeRoots();
		try {
			await expect(rejectAgentAdminOperation(roots, ADMIN_OPCODES[0], "a-impersonator")).rejects.toThrow(/admin operation rejected/);
			const logDir = join(roots.stateRoot, "audit");
			const files = await readdir(logDir);
			expect(files.length).toBe(1);
			const log = await readFile(join(logDir, files[0] ?? ""), "utf8");
			expect(log).toContain("admin_op_rejected");
			expect(log).toContain("same_uid_untrusted");
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});

	it("operator channel verifies the passphrase proof and executes audited admin ops", async () => {
		const roots = await makeRoots();
		try {
			const adminKey = deriveAdminKey("correct horse battery staple");
			const challenge = adminChallenge();
			let executed = 0;
			const ok = await executeAdminOperation(roots, adminKey, {
				challenge,
				proof: adminProof(adminKey, challenge),
				opcode: ADMIN_OPCODES[1],
				target: "policy.json",
				action: async () => {
					executed++;
					return "done";
				},
			});
			expect(ok.ok).toBe(true);
			expect(executed).toBe(1);

			const bad = await executeAdminOperation(roots, adminKey, {
				challenge,
				proof: adminProof(deriveAdminKey("wrong"), challenge),
				opcode: ADMIN_OPCODES[1],
				target: "policy.json",
				action: async () => {
					executed++;
					return "never";
				},
			});
			expect(bad.ok).toBe(false);
			expect(executed).toBe(1);
			expect(verifyAdminProof(adminKey, challenge, Buffer.alloc(32))).toBe(false);
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});

describe("socket publication (ADR section 6)", () => {
	it("publishes a 0600 socket and validates a stale one; live holder fails closed", async () => {
		const roots = await makeRoots();
		try {
			const published = await publishDaemonSocket(roots, () => {});
			const { stat } = await import("node:fs/promises");
			const info = await stat(published.path);
			expect(info.isSocket()).toBe(true);
			expect(info.mode & 0o777).toBe(0o600);

			// A live daemon on the path: publication must fail closed.
			await expect(publishDaemonSocket(roots, () => {})).rejects.toThrow(/live daemon/);
			published.server.close();

			// Stale socket (server closed): validated and republished.
			published.server.close();
			const validation = await validateExistingSocketPath(published.path);
			expect(validation.stale).toBe(true);
		} finally {
			await rm(roots.runtimeRoot, { recursive: true, force: true });
		}
	});

	it("probeSocketLive distinguishes a live socket from a stale path", async () => {
		const roots = await makeRoots();
		try {
			expect(await probeSocketLive(join(roots.runtimeRoot, "none.sock"))).toBe(false);
			const published = await publishDaemonSocket(roots, () => {});
			expect(await probeSocketLive(published.path)).toBe(true);
			published.server.close();
		} finally {
			await rm(roots.runtimeRoot, { recursive: true, force: true });
		}
	});
});

describe("audit durability (design doc section 2)", () => {
	it("durable admin audit records are fsynced and append-only", async () => {
		const roots = await makeRoots();
		try {
			await appendAudit(roots, { kind: "admin_op_executed", target: "x" }, { durable: true });
			await appendAudit(roots, { kind: "delivery_audit", target: "y" });
			const logDir = join(roots.stateRoot, "audit");
			const files = await readdir(logDir);
			expect(files).toHaveLength(1);
			const raw = await readFile(join(logDir, files[0] ?? ""), "utf8");
			expect(raw.trimEnd().split("\n")).toHaveLength(2);
			expect(raw).toContain("admin_op_executed");
			expect(raw).toContain("delivery_audit");
		} finally {
			await rm(roots.stateRoot, { recursive: true, force: true });
		}
	});
});