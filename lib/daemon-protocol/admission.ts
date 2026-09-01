/**
 * Published daemon admission proof surface (ADR-053): the pure HMAC-SHA256
 * capability proof a client computes to answer the daemon's nonce challenge
 * (ADR-0018 section 2, design doc section 9). Verification is daemon-only
 * and stays private in daemon/src/admission.ts. The spawn-scope tag moves
 * here from daemon/src/identity.ts as the single authoritative definition.
 */
import { createHmac } from "node:crypto";

/** ADR-0008 (7) spawn scope tag, stamped by the daemon at admission. */
export type AdmissionScope = "root" | "task" | "workspace";

/** Proof-of-possession: HMAC(capability, nonce), constant-time compared. */
export function capabilityProof(
	capabilitySecret: string,
	nonce: string,
): Buffer {
	return createHmac("sha256", capabilitySecret).update(nonce).digest();
}
