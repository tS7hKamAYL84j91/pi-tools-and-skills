/**
 * Peer resolution helpers for pi-agent-hub.
 *
 * Shared by messaging.ts and health.ts to eliminate duplication of
 * getSelfName(), resolvePeer(), peerNames(), and notFound().
 */

import type { AgentRecord } from "../types.js";
import { ok } from "../types.js";
import type { Registry } from "../types.js";
import { agentBaseName, agentDisplayName, findAgentByDisplayName } from "../../../lib/agent-names.js";
import { isReservedName, reservedNamesFor } from "./namespace-ownership.js";
import { visibleRecords } from "./visibility.js";

/** Get the current agent's display name (namespace-qualified for helpers). */
export function getSelfName(registry: Registry): string {
	const record = registry.getRecord();
	return record ? agentBaseName(record) : "unknown";
}

/** Resolve a peer agent by name (case-insensitive, excludes self). */
export function resolvePeer(registry: Registry, name: string): AgentRecord | undefined {
	const self = registry.getRecord();
	const records = visibleRecords(self, registry.readAllPeers()).filter(
		(record) => !self || record.id !== self.id,
	);
	// A bare label reserved for a lead (durable ownership journal) is satisfied
	// only by a namespace-less record. This keeps messaging a lead working while
	// it is online and still stops a helper's spawn alias from answering the
	// lead's label after the lead has stopped.
	const selector = name.replace(/^@/, "").trim();
	if (selector && !selector.includes("/")) {
		const reserved = reservedNamesFor({
			selfId: registry.selfId ?? self?.id ?? "",
		});
		if (isReservedName(selector, reserved)) {
			return findAgentByDisplayName(
				records.filter((record) => !record.namespace),
				name,
			);
		}
	}
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
