/**
 * Registry release audit trail.
 *
 * Isolated from lib/agent-registry.ts to avoid cross-module coupling.
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { ensureRegistryDir, REGISTRY_DIR } from "../../../lib/agent-registry.js";

const PRIVATE_FILE_MODE = 0o600;
const REGISTRY_AUDIT_LOG = join(REGISTRY_DIR, "audit.jsonl");

/** Append a structured, timestamped audit entry when a registry entry is released.
 * Best-effort: failures are swallowed so audit logging never breaks the reap path.
 */
export function auditRegistryRelease(agentId: string, name: string, reason: string): void {
	try {
		ensureRegistryDir();
		const entry = { ts: Date.now(), agentId, name, reason };
		appendFileSync(REGISTRY_AUDIT_LOG, `${JSON.stringify(entry)}\n`, { encoding: "utf-8", mode: PRIVATE_FILE_MODE });
	} catch {
		/* best-effort audit trail */
	}
}
