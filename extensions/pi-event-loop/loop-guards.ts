/** Loop-protection guards over the projection: chain depth and per-view open-item limits (SPEC §14). */

import type { TodoProjection } from "./projector.js";
import { openItemCount } from "./todo-view.js";
import type { LimitsConfig } from "./types.js";

/**
 * Causal chain depth of an event: the number of automated command hops between the
 * event and its root. An event that closed work items sits one hop below the deepest
 * opening event of those items; root events (no closed items) have depth 0.
 * Depth is derived from the projection, so it survives snapshot restore and rebuild.
 */
export function eventChainDepth(
	eventId: string,
	projection: TodoProjection,
): number {
	const memo = new Map<string, number>();
	const depthOf = (candidateId: string): number => {
		const cached = memo.get(candidateId);
		if (cached !== undefined) {
			return cached;
		}
		// Cycle guard: a revisit is treated as a root; chains walk strictly backward
		// through opening events, so this is defensive only.
		memo.set(candidateId, 0);
		let depth = 0;
		for (const item of projection.items.values()) {
			if (item.completedByEventId !== candidateId) {
				continue;
			}
			depth = Math.max(depth, depthOf(item.openedByEventId) + 1);
		}
		memo.set(candidateId, depth);
		return depth;
	};
	return depthOf(eventId);
}

/**
 * First view whose open (non-completed) item count exceeds maxOpenItemsPerView, with an
 * operator-visible reason; undefined when every view is within its limit (SPEC §14).
 */
export function findOpenItemLimitViolation(
	projection: TodoProjection,
	limits: LimitsConfig,
): string | undefined {
	const viewIds = new Set<string>();
	for (const item of projection.items.values()) {
		viewIds.add(item.viewId);
	}
	for (const viewId of viewIds) {
		const open = openItemCount(projection, viewId);
		if (open > limits.maxOpenItemsPerView) {
			return `open-item-limit: view "${viewId}" has ${open} open items, exceeding maxOpenItemsPerView ${limits.maxOpenItemsPerView}`;
		}
	}
	return undefined;
}
