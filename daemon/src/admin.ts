/**
 * Administrative control plane (ADR section 8, design doc section 9).
 *
 * In same_uid_untrusted mode administrative operations are disabled on the
 * agent-facing surface fail-closed: they run only through the admin channel
 * with a knowledge-based passphrase proof (HMAC challenge over a
 * passphrase-derived key held only in the operator process's memory).
 * Every admin action — successful or rejected — writes a durable audit event.
 */
import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { appendAudit } from "./audit.js";
import type { DaemonRoots } from "./paths.js";

/** Opcodes the agent-facing socket must always reject in same_uid_untrusted. */
export const ADMIN_OPCODES = ["identity_rebind", "policy_change", "lock_takeover", "purge"] as const;
export type AdminOpcode = (typeof ADMIN_OPCODES)[number];

/** Passphrase-derived key: computed at invocation, never persisted. */
export function deriveAdminKey(passphrase: string): Buffer {
	return createHash("sha256").update(`coas-daemon-admin\0${passphrase}`, "utf8").digest();
}

export function adminChallenge(): string {
	return randomBytes(32).toString("hex");
}

export function adminProof(adminKey: Buffer, challenge: string): Buffer {
	return createHmac("sha256", adminKey).update(challenge).digest();
}

export function verifyAdminProof(adminKey: Buffer, challenge: string, proof: Buffer): boolean {
	const expected = adminProof(adminKey, challenge);
	if (proof.length !== expected.length) return false;
	return timingSafeEqual(proof, expected);
}

/** Agent-socket admin attempt: always rejected fail-closed, always audited. */
export async function rejectAgentAdminOperation(
	roots: DaemonRoots,
	requestedOpcode: string,
	senderAgentId: string | undefined,
): Promise<never> {
	await appendAudit(roots, {
		kind: "admin_op_rejected",
		posture: "same_uid_untrusted",
		reason: "admin operations require the operator admin channel (agent-reachable surface is disabled)",
		requestedOpcode,
		senderAgentId: senderAgentId ?? "(unknown)",
	}, { durable: true });
	throw new Error(`admin operation rejected: ${requestedOpcode} is disabled in same_uid_untrusted; use the operator admin channel`);
}

/** Operator-channel admin execution: verifies the passphrase proof, audits durably. */
export async function executeAdminOperation(
	roots: DaemonRoots,
	adminKey: Buffer,
	input: {
		readonly challenge: string;
		readonly proof: Buffer;
		readonly opcode: (typeof ADMIN_OPCODES)[number];
		readonly target: string;
		readonly action: () => Promise<unknown>;
	},
): Promise<{ ok: boolean; result?: unknown }> {
	if (!verifyAdminProof(adminKey, input.challenge, input.proof)) {
		await appendAudit(roots, {
			kind: "admin_op_rejected",
			channel: "operator",
			reason: "passphrase_proof_invalid",
			requestedOpcode: input.opcode,
			target: input.target,
		}, { durable: true });
		return { ok: false };
	}
	const result = await input.action();
	await appendAudit(roots, {
		kind: "admin_op_executed",
		channel: "operator",
		requestedOpcode: input.opcode,
		target: input.target,
	}, { durable: true });
	return { ok: true, result };
}