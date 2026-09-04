/** Pure, replayable todo projections over the ordered event history (SPEC §9). */

import { projectionKey } from "./json-pointer.js";
import type { EventLoopConfig, LoopEventData, TodoItem } from "./types.js";
import { deriveWorkItemId } from "./types.js";

export interface TodoProjection {
	/** Work items keyed by deterministic work item id. */
	readonly items: ReadonlyMap<string, TodoItem>;
	/** Work item ids in opening-event order; the deterministic row sequence for automators. */
	readonly order: readonly string[];
}

interface ProjectionAccumulator {
	readonly items: Map<string, TodoItem>;
	readonly order: string[];
}

export const EMPTY_PROJECTION: TodoProjection = {
	items: new Map<string, TodoItem>(),
	order: [],
};

/** Replay an ordered event history into a deterministic projection. */
export function replayEvents(
	config: EventLoopConfig,
	profileName: string,
	events: readonly LoopEventData[],
): TodoProjection {
	const state: ProjectionAccumulator = {
		items: new Map<string, TodoItem>(),
		order: [],
	};
	for (const event of events) {
		applyEventInto(state, config, profileName, event);
	}
	return { items: state.items, order: state.order };
}

/** Apply one event to a projection and return a new projection; the input is not mutated. */
export function applyEvent(
	projection: TodoProjection,
	config: EventLoopConfig,
	profileName: string,
	event: LoopEventData,
): TodoProjection {
	const state: ProjectionAccumulator = {
		items: new Map(projection.items),
		order: [...projection.order],
	};
	applyEventInto(state, config, profileName, event);
	return { items: state.items, order: state.order };
}

function applyEventInto(
	state: ProjectionAccumulator,
	config: EventLoopConfig,
	profileName: string,
	event: LoopEventData,
): void {
	const profile = config.profiles[profileName];
	if (profile === undefined) {
		return;
	}
	// Per-view application is independent, so configuration order cannot change the result.
	for (const viewName of Object.keys(profile.views)) {
		const view = profile.views[viewName];
		if (view === undefined) {
			continue;
		}
		for (const rule of view.openOn) {
			if (rule.event !== event.type) {
				continue;
			}
			const key = projectionKey(event.payload, rule.keyFrom);
			if (key === undefined) {
				continue;
			}
			const workItemId = deriveWorkItemId(
				profileName,
				viewName,
				key,
				event.eventId,
			);
			if (!state.items.has(workItemId)) {
				state.items.set(workItemId, {
					workItemId,
					viewId: viewName,
					key,
					openedByEventId: event.eventId,
					sourcePayload: event.payload,
					status: "outstanding",
				});
				state.order.push(workItemId);
			}
		}
		for (const rule of view.closeOn) {
			if (rule.event !== event.type) {
				continue;
			}
			const key = projectionKey(event.payload, rule.keyFrom);
			if (key === undefined) {
				continue;
			}
			// Complete every open row with the matching key; never fabricate rows here.
			for (const itemId of state.order) {
				const item = state.items.get(itemId);
				if (
					item === undefined ||
					item.viewId !== viewName ||
					item.key !== key ||
					item.status === "completed"
				) {
					continue;
				}
				state.items.set(itemId, {
					...item,
					status: "completed",
					completedByEventId: event.eventId,
				});
			}
		}
	}
}
