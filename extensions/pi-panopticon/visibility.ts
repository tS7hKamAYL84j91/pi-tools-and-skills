/**
 * Visibility helpers for scoped panopticon peer discovery.
 *
 * Manual/root agents keep legacy global visibility. Spawned children are scoped
 * to their direct parent plus siblings under that parent.
 */

import type { AgentRecord } from "../../lib/agent-registry.js";

/** Environment variable used by spawn_agent to scope child visibility. */
export const PARENT_ID_ENV = "PI_PANOPTICON_PARENT_ID";
/** Environment variable used by spawn_agent to mark children as scoped. */
export const VISIBILITY_ENV = "PI_PANOPTICON_VISIBILITY";

/** Return true when requester is allowed to discover/contact target. */
export function canSee(requester: AgentRecord | undefined, target: AgentRecord): boolean {
	if (!requester) return true;
	if (requester.id === target.id) return true;

	// Manual/root agents keep the legacy global view by default.
	if ((requester.visibility ?? "global") === "global") return true;

	// Scoped agents can see their parent.
	if (requester.parentId && target.id === requester.parentId) return true;

	// Scoped agents can see siblings under the same parent.
	if (requester.parentId && target.parentId === requester.parentId) return true;

	// Any agent can see its direct children.
	if (target.parentId === requester.id) return true;

	return false;
}

/** Filter records to those visible to the current registry record. */
export function visibleRecords(self: AgentRecord | undefined, records: AgentRecord[]): AgentRecord[] {
	return records.filter((record) => canSee(self, record));
}
