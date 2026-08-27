/**
 * Admission binding (ADR-0018 section 2, design doc section 9).
 *
 * Node stdlib exposes no SO_PEERCRED, so under the same_uid_untrusted posture
 * the binding primitive is a daemon-issued per-instance capability secret:
 * the client proves possession by answering an HMAC challenge. Possession is
 * NOT authentication (label same_uid_untrusted, per ADR section 1); peer-cred
 * binding is the authenticated-mode upgrade path.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { admitNewInstance, type IdentityRecord } from "./identity.js";
import { appendAudit } from "./audit.js";
import type { DaemonRoots } from "./paths.js";

export const ADMISSION_LABEL = "same_uid_untrusted";

export interface InstanceCapability {
	readonly agentId: string;
	readonly instanceId: string;
	readonly generation: number;
	/** Daemon-issued secret, delivered out-of-band at admission; possession binds. */
	readonly capabilitySecret: string;
	readonly label: typeof ADMISSION_LABEL;
}

export interface LiveBinding {
	readonly agentId: string;
	readonly instanceId: string;
	readonly generation: number;
	readonly label: typeof ADMISSION_LABEL;
	readonly admittedAt: string;
}

export interface AdmissionResult {
	readonly binding: LiveBinding;
	readonly capability: InstanceCapability;
}

/**
 * Admit an instance of an existing agent: bumps the generation (durable
 * before any binding publish) and issues the capability secret. The caller
 * delivers the secret out-of-band to the admitted process.
 */
export async function admitInstance(
	roots: DaemonRoots,
	keys: { keyId: string; privateKeyPem: string },
	identity: IdentityRecord,
): Promise<AdmissionResult> {
	const { record, instanceId } = await admitNewInstance(roots, keys, identity);
	const capabilitySecret = randomCapabilitySecret();
	const binding: LiveBinding = {
		agentId: record.agentId,
		instanceId,
		generation: record.generation,
		label: ADMISSION_LABEL,
		admittedAt: new Date().toISOString(),
	};
	await appendAudit(roots, {
		kind: "instance_admitted",
		agentId: record.agentId,
		instanceId,
		generation: record.generation,
		label: ADMISSION_LABEL,
	});
	return { binding, capability: { agentId: record.agentId, instanceId, generation: record.generation, capabilitySecret, label: ADMISSION_LABEL } };
}

/** Proof-of-possession: HMAC(capability, nonce), constant-time compared. */
function randomCapabilitySecret(): string {
	return randomBytes(32).toString("base64");
}

export function capabilityProof(capabilitySecret: string, nonce: string): Buffer {
	return createHmac("sha256", capabilitySecret).update(nonce).digest();
}

export function verifyCapabilityProof(capabilitySecret: string, nonce: string, proof: Buffer): boolean {
	const expected = capabilityProof(capabilitySecret, nonce);
	if (proof.length !== expected.length) return false;
	return timingSafeEqual(proof, expected);
}

/**
 * A2A send attribution: every send is attributed from the admitted binding's
 * capability proof, never from caller-supplied identity fields (ADR section 2).
 */
export function verifySenderBinding(
	binding: LiveBinding | undefined,
	expected: { readonly agentId: string; readonly instanceId: string; readonly generation: number },
): boolean {
	if (!binding) return false;
	return (
		binding.agentId === expected.agentId &&
		binding.instanceId === expected.instanceId &&
		binding.generation === expected.generation &&
		binding.label === ADMISSION_LABEL
	);
}

export { appendAudit as auditAppendForAdmission };