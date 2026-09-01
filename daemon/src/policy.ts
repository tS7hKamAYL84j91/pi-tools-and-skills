/**
 * Peer authorization policy (ADR section 6/8): deny-by-default allowlist over
 * sender/recipient agent ids, message type, and optional exact generation,
 * evaluated once at enqueue time and recorded in the signed envelope. Policy
 * records are signed with the daemon integrity key; unsigned/invalid policy
 * files are rejected. In same_uid_untrusted mode agents cannot edit their own
 * policy files — changes arrive through the operator admin channel.
 */
import { join } from "node:path";
import { writeDurableFileReplace } from "./durable-fs.js";
import type { identitiesDir } from "./paths.js";
import { signBytes, verifyBytes } from "./keys.js";
import { canonicalJcs } from "./jcs.js";

export interface PolicyEntry {
	readonly senderAgentId: string;
	readonly recipientAgentId: string;
	/** Message types allowed; omit to allow all types for this pair. */
	readonly payloadTypes?: readonly string[];
	/** Optional exact recipient generation requirement. */
	readonly recipientGeneration?: number;
}

export interface PolicyRecord {
	readonly updatedAt: string;
	readonly keyId: string;
	readonly entries: readonly PolicyEntry[];
	readonly signature: string;
}

export type PolicyDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

function policyPath(roots: Parameters<typeof identitiesDir>[0]): string {
	return join(roots.stateRoot, "registry", "policy.json");
}

/** Canonical policy bytes: the record minus the signature field, JCS order. */
function policySigningBytes(record: Omit<PolicyRecord, "signature">): Uint8Array {
	return Buffer.from(canonicalJcs(record), "utf8");
}

export async function savePolicy(
	roots: Parameters<typeof identitiesDir>[0],
	keys: { keyId: string; privateKeyPem: string },
	entries: readonly PolicyEntry[],
): Promise<PolicyRecord> {
	const unsigned = {
		updatedAt: new Date().toISOString(),
		keyId: keys.keyId,
		entries: [...entries],
	};
	const signature = signBytes(keys.privateKeyPem, policySigningBytes(unsigned)).toString("base64");
	const record: PolicyRecord = { ...unsigned, signature };
	await writeDurableFileReplace(policyPath(roots), `${JSON.stringify(record, null, 2)}\n`, 0o600, roots.stateRoot);
	return record;
}

/**
 * Load the signed policy; missing file = empty deny-all policy (fail closed).
 * Tampered/unknown-key policy is an error (never trusted, ADR section 8).
 */
export async function loadPolicy(
	roots: Parameters<typeof identitiesDir>[0],
	verificationKeys: ReadonlyMap<string, string>,
): Promise<PolicyRecord> {
	// Invalid or untrusted policy data is intentionally surfaced; callers must not proceed with an unverifiable policy.
	const { readFile } = await import("node:fs/promises");
	const raw = await readFile(policyPath(roots), "utf8");
	let parsed: PolicyRecord;
	try {
		parsed = JSON.parse(raw) as PolicyRecord;
	} catch (error: unknown) {
		throw error instanceof Error ? error : new Error(String(error));
	}
	const key = verificationKeys.get(parsed.keyId);
	if (!key) throw new Error(`unknown policy key: ${parsed.keyId}`);
	const { signature, ...unsigned } = parsed;
	if (!verifyBytes(key, policySigningBytes(unsigned), Buffer.from(signature, "base64"))) {
		throw new Error("policy record signature invalid");
	}
	return parsed;
}

/** Deny-by-default authorization decision at enqueue time. */
export function authorizeSend(
	policy: PolicyRecord,
	input: {
		readonly senderAgentId: string;
		readonly recipientAgentId: string;
		readonly payloadType: string;
		readonly recipientGeneration: number | null;
	},
): PolicyDecision {
	for (const entry of policy.entries) {
		if (entry.senderAgentId !== input.senderAgentId) continue;
		if (entry.recipientAgentId !== input.recipientAgentId) continue;
		if (entry.payloadTypes !== undefined && !entry.payloadTypes.includes(input.payloadType)) continue;
		if (entry.recipientGeneration !== undefined && input.recipientGeneration !== entry.recipientGeneration) continue;
		return { allowed: true };
	}
	return { allowed: false, reason: "no allowlist entry matches (deny-by-default)" };
}