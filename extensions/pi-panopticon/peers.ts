/**
 * Peer resolution helpers for pi-panopticon.
 *
 * Shared by messaging.ts and health.ts to eliminate duplication of
 * getSelfName(), resolvePeer(), peerNames(), and notFound().
 */

import type { AgentRecord } from "./types.js";
import { ok } from "./types.js";
import type { Registry } from "./types.js";

/** Get the current agent's display name. */
export function getSelfName(registry: Registry): string {
	return registry.getRecord()?.name ?? "unknown";
}

/** Resolve a peer agent by name (case-insensitive, excludes self). */
export function resolvePeer(registry: Registry, name: string): AgentRecord | undefined {
	const lower = name.toLowerCase();
	const self = registry.getRecord();
	return registry.readAllPeers().find(
		(r) => r.name.toLowerCase() === lower && (!self || r.id !== self.id),
	);
}

/** Comma-separated list of known peer names (excludes self). */
export function peerNames(registry: Registry): string {
	const self = registry.getRecord();
	return registry.readAllPeers()
		.filter((r) => !self || r.id !== self.id)
		.map((r) => r.name)
		.join(", ") || "(none)";
}

/** Standard "not found" tool result with peer listing. */
export function notFound(registry: Registry, name: string) {
	return ok(
		`No agent named "${name}". Known peers: ${peerNames(registry)}`,
		{ name, error: "not_found" },
	);
}
