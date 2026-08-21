/** Immutable capacity accounting for one hierarchical swarm tree. */

import type { HierarchicalSwarmBounds, HierarchicalSwarmInheritedCapacity } from "../team-types.js";

export interface HierarchicalCapacity extends HierarchicalSwarmInheritedCapacity {
	depth: number;
	/** Monotonic snapshot timestamp used to debit TTL once per tree edge. */
	snapshotAt: number;
}

export function rootCapacity(bounds: HierarchicalSwarmBounds, snapshotAt: number = Date.now()): HierarchicalCapacity {
	return {
		depth: 0,
		snapshotAt,
		...(bounds.maxDepth === undefined ? {} : { remainingDepth: bounds.maxDepth }),
		...(bounds.maxChildrenPerNode === undefined ? {} : { remainingChildren: bounds.maxChildrenPerNode }),
		...(bounds.maxTotalNodes === undefined ? {} : { remainingTotalNodes: bounds.maxTotalNodes - 1 }),
		...(bounds.maxWip === undefined ? {} : { availableWip: bounds.maxWip }),
		...(bounds.ttlMs === undefined ? {} : { remainingTtlMs: bounds.ttlMs }),
		...(bounds.maxRepairCycles === undefined ? {} : { remainingRepairCycles: bounds.maxRepairCycles }),
		writeIsolation: bounds.writeIsolation,
	};
}

/** True only when a parent has capacity to create one child. */
export function canSpawn(capacity: HierarchicalCapacity, totalRemaining: number | undefined): boolean {
	return (capacity.remainingDepth === undefined || capacity.remainingDepth > 0)
		&& (capacity.remainingChildren === undefined || capacity.remainingChildren > 0)
		&& (totalRemaining === undefined || totalRemaining > 0)
		&& (capacity.remainingTtlMs === undefined || capacity.remainingTtlMs > 0);
}

/** Derives a child budget without adding a platform-imposed numeric ceiling. */
export function childCapacity(
	parent: HierarchicalCapacity,
	totalRemaining: number | undefined,
	snapshotAt: number,
	childrenPerNode: number | undefined,
): HierarchicalCapacity {
	const elapsedMs = Math.max(0, snapshotAt - parent.snapshotAt);
	return {
		depth: parent.depth + 1,
		snapshotAt,
		...(parent.remainingDepth === undefined ? {} : { remainingDepth: parent.remainingDepth - 1 }),
		...(childrenPerNode === undefined ? {} : { remainingChildren: childrenPerNode }),
		...(totalRemaining === undefined ? {} : { remainingTotalNodes: totalRemaining }),
		...(parent.availableWip === undefined ? {} : { availableWip: parent.availableWip }),
		...(parent.remainingTtlMs === undefined ? {} : { remainingTtlMs: Math.max(0, parent.remainingTtlMs - elapsedMs) }),
		...(parent.remainingRepairCycles === undefined ? {} : { remainingRepairCycles: parent.remainingRepairCycles }),
		writeIsolation: parent.writeIsolation,
	};
}
