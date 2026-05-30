/**
 * Peer resolution helpers for pi-panopticon.
 *
 * Shared by messaging.ts and health.ts to eliminate duplication of
 * getSelfName(), resolvePeer(), peerNames(), and notFound().
 */

import type { AgentRecord } from "../types.js";
import { ok } from "../types.js";
import type { Registry } from "../types.js";
import { agentDisplayName, findAgentByDisplayName } from "../ui/display-name.js";
import { visibleRecords } from "./visibility.js";

/** Get the current agent's display name. */
export function getSelfName(registry: Registry): string {
	return registry.getRecord()?.name ?? "unknown";
}

/** Resolve a peer agent by name (case-insensitive, excludes self). */
export function resolvePeer(registry: Registry, name: string): AgentRecord | undefined {
	const self = registry.getRecord();
	const records = visibleRecords(self, registry.readAllPeers()).filter(
		(record) => !self || record.id !== self.id,
	);
	return findAgentByDisplayName(records, name);
}

/** Comma-separated list of known peer names (excludes self). */
export function peerNames(registry: Registry): string {
	const self = registry.getRecord();
	const records = visibleRecords(self, registry.readAllPeers()).filter(
		(record) => !self || record.id !== self.id,
	);
	return records.map((record) => agentDisplayName(record, records)).join(", ") || "(none)";
}

/** Standard "not found" tool result with peer listing. */
export function notFound(registry: Registry, name: string) {
	return ok(
		`No agent named "${name}". Known peers: ${peerNames(registry)}`,
		{ name, error: "not_found" },
	);
}
