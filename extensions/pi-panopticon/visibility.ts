/**
 * Visibility helpers for scoped panopticon peer discovery.
 *
 * Manual/root agents keep legacy global visibility. Spawned children are scoped
 * to their direct parent plus siblings under that parent.
 */

import type { AgentRecord } from "../../lib/agent-registry.js";

/** Query-time display mode for passive agent lists/widgets. */
export type AgentListMode = "all" | "children" | "roots" | "scope";

const AGENT_LIST_MODES: AgentListMode[] = ["all", "children", "roots", "scope"];

/** Return true for supported list modes. */
export function isAgentListMode(value: string): value is AgentListMode {
	return AGENT_LIST_MODES.includes(value as AgentListMode);
}

/** Default list mode preserves legacy global behavior while keeping scoped workers scoped. */
export function defaultAgentListMode(self: AgentRecord | undefined): AgentListMode {
	return (self?.visibility ?? "global") === "scoped" ? "scope" : "all";
}

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

function isDirectFamily(self: AgentRecord, target: AgentRecord): boolean {
	return target.id === self.id || target.id === self.parentId || target.parentId === self.id;
}

/**
 * Filter records for passive displays/lists. This is a view preference, not an
 * access-control rule; direct targeted operations should use visibleRecords().
 */
export function filterAgentList(
	self: AgentRecord | undefined,
	records: AgentRecord[],
	mode: AgentListMode = defaultAgentListMode(self),
): AgentRecord[] {
	const visible = visibleRecords(self, records);
	if (!self || mode === "all") return visible;
	if (mode === "scope") {
		return visible.filter(
			(record) => isDirectFamily(self, record) || (self.parentId !== undefined && record.parentId === self.parentId),
		);
	}
	if (mode === "roots") {
		return visible.filter((record) => isDirectFamily(self, record) || !record.parentId);
	}
	return visible.filter(
		(record) => isDirectFamily(self, record) || !record.parentId || record.parentId === self.id,
	);
}
