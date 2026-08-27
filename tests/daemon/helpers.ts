/** Shared helpers for daemon tests. */
import { loadOrCreateIntegrityKey } from "../../daemon/src/keys.js";
import { savePolicy } from "../../daemon/src/policy.js";
import type { DaemonRoots } from "../../daemon/src/paths.js";

export { loadOrCreateIntegrityKey };

export async function savePolicyFileForTest(
	roots: DaemonRoots,
	keys: { readonly keyId: string; readonly privateKeyPem: string },
	entries: readonly { senderAgentId: string; recipientAgentId: string; payloadTypes?: readonly string[] }[],
): Promise<void> {
	const policyEntries = entries.map((entry) => ({ ...entry }));
	await savePolicy(roots, keys, policyEntries);
}

