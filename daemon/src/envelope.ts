/**
 * Authenticated A2A envelope (ADR-0018 section 3): daemon-issued message_id,
 * caller idempotency_key, expires_at bound, Ed25519-signed canonical bytes
 * (JCS, RFC 8785) with the daemon integrity key; key_id retained for rotation.
 * Caller-supplied identity and timestamp fields are ignored — the daemon
 * constructs the envelope after authenticating and authorizing the enqueue.
 */
import { createHash, randomBytes } from "node:crypto";
import { canonicalJcs } from "./jcs.js";
import { signBytes, verifyBytes } from "./keys.js";

export const ENVELOPE_VERSION = 1;

export type GenerationPolicy = "stable_mailbox" | "exact";

export interface EnvelopeFields {
	readonly version: number;
	readonly message_id: string;
	readonly idempotency_key: string;
	readonly expires_at: string;
	readonly key_id: string;
	readonly sender_agent_id: string;
	readonly sender_instance_id: string;
	readonly sender_generation: number;
	readonly recipient_agent_id: string;
	readonly recipient_generation_policy: GenerationPolicy;
	/** null for stable_mailbox; the required generation for exact. */
	readonly recipient_generation: number | null;
	readonly enqueued_at: string;
	readonly payload_type: string;
	readonly payload_length: number;
	readonly payload_sha256: string;
	readonly payload: string;
}

export interface SignedEnvelope {
	readonly envelope: EnvelopeFields;
	/** Ed25519 signature (base64) over the JCS bytes of `envelope`. */
	readonly signature: string;
}

export const MAX_PAYLOAD_BYTES = 256 * 1024;

/** Daemon-issued message_id: 128 bits of cryptographic randomness. */
export function newMessageId(): string {
	return `m-${randomBytes(16).toString("hex")}`;
}

/** Construct the envelope (daemon-side): caller identity/timestamps are ignored. */
export function buildEnvelope(
	keys: { keyId: string },
	input: {
		readonly idempotencyKey: string;
		readonly expiresAt: Date;
		readonly sender: { readonly agentId: string; readonly instanceId: string; readonly generation: number };
		readonly recipientAgentId: string;
		readonly recipientGenerationPolicy: GenerationPolicy;
		readonly recipientGeneration: number | null;
		readonly payloadType: string;
		readonly payload: string;
	},
): EnvelopeFields {
	const payloadLength = Buffer.byteLength(input.payload, "utf8");
	if (payloadLength > MAX_PAYLOAD_BYTES) {
		throw new Error(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes: ${payloadLength}`);
	}
	return {
		version: ENVELOPE_VERSION,
		message_id: newMessageId(),
		idempotency_key: input.idempotencyKey,
		expires_at: input.expiresAt.toISOString(),
		key_id: keys.keyId,
		sender_agent_id: input.sender.agentId,
		sender_instance_id: input.sender.instanceId,
		sender_generation: input.sender.generation,
		recipient_agent_id: input.recipientAgentId,
		recipient_generation_policy: input.recipientGenerationPolicy,
		recipient_generation: input.recipientGeneration,
		enqueued_at: new Date().toISOString(),
		payload_type: input.payloadType,
		payload_length: payloadLength,
		payload_sha256: sha256Hex(input.payload),
		payload: input.payload,
	};
}

export function sha256Hex(payload: string): string {
	return createHash("sha256").update(payload, "utf8").digest("hex");
}

/** Signed bytes: JCS output of the complete envelope (signature detached). */
export function envelopeSigningBytes(envelope: EnvelopeFields): Uint8Array {
	return Buffer.from(canonicalJcs(envelope), "utf8");
}

export function signEnvelope(privateKeyPem: string, envelope: EnvelopeFields): SignedEnvelope {
	const signature = signBytes(privateKeyPem, envelopeSigningBytes(envelope)).toString("base64");
	return { envelope, signature };
}

/**
 * Reader verification (ADR section 3): parse is strict upstream; reproduce
 * canonical bytes; verify Ed25519 for key_id (constant-time library
 * primitives); recompute payload_length and SHA-256. Any failure is a
 * verification failure — the caller quarantines/dead-letters.
 */
export function verifyEnvelope(signed: SignedEnvelope, verificationKeys: ReadonlyMap<string, string>): { ok: true } | { ok: false; reason: string } {
	const key = verificationKeys.get(signed.envelope.key_id);
	if (!key) return { ok: false, reason: `unknown key_id: ${signed.envelope.key_id}` };
	if (!verifyBytes(key, envelopeSigningBytes(signed.envelope), Buffer.from(signed.signature, "base64"))) {
		return { ok: false, reason: "signature invalid" };
	}
	if (signed.envelope.payload_length !== Buffer.byteLength(signed.envelope.payload, "utf8")) {
		return { ok: false, reason: "payload_length mismatch" };
	}
	if (signed.envelope.payload_sha256 !== sha256Hex(signed.envelope.payload)) {
		return { ok: false, reason: "payload_sha256 mismatch" };
	}
	return { ok: true };
}