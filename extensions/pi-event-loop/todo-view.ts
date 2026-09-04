/** Todo view queries and pure status transitions (SPEC §9, §11). */
import type { TodoProjection } from "./projector.js";
import type { TodoItem } from "./types.js";

export function findItem(
	projection: TodoProjection,
	workItemId: string,
): TodoItem | undefined {
	return projection.items.get(workItemId);
}

/** Outstanding rows of one view in deterministic row sequence. */
export function outstandingItems(
	projection: TodoProjection,
	viewId: string,
): readonly TodoItem[] {
	const items: TodoItem[] = [];
	for (const itemId of projection.order) {
		const item = projection.items.get(itemId);
		if (
			item !== undefined &&
			item.viewId === viewId &&
			item.status === "outstanding"
		) {
			items.push(item);
		}
	}
	return items;
}

/** Count non-completed rows of one view; bounded by maxOpenItemsPerView (SPEC §14). */
export function openItemCount(
	projection: TodoProjection,
	viewId: string,
): number {
	let count = 0;
	for (const itemId of projection.order) {
		const item = projection.items.get(itemId);
		if (
			item !== undefined &&
			item.viewId === viewId &&
			item.status !== "completed"
		) {
			count++;
		}
	}
	return count;
}

function updateTodoItem(
	projection: TodoProjection,
	workItemId: string,
	predicate: (item: TodoItem) => boolean,
	patch: (item: TodoItem) => Partial<TodoItem>,
): TodoProjection {
	const item = projection.items.get(workItemId);
	if (item === undefined || !predicate(item)) {
		return projection;
	}
	const items = new Map(projection.items);
	items.set(workItemId, { ...item, ...patch(item) });
	return { items, order: projection.order };
}

/** Mark a delivered command's item as dispatched; returns a new projection. */
export function markItemDispatched(
	projection: TodoProjection,
	workItemId: string,
	commandId: string,
): TodoProjection {
	return updateTodoItem(
		projection,
		workItemId,
		(item) => item.status !== "completed",
		() => ({ status: "dispatched", commandId }),
	);
}

/** Reopen a stalled item for an explicit operator retry; returns a new projection. */
export function markItemOutstanding(
	projection: TodoProjection,
	workItemId: string,
): TodoProjection {
	return updateTodoItem(
		projection,
		workItemId,
		(item) => item.status === "stalled",
		() => ({ status: "outstanding", commandId: undefined }),
	);
}

/** Mark an item stalled after settlement without an expected outcome (SPEC §11); returns a new projection. */
export function markItemStalled(
	projection: TodoProjection,
	workItemId: string,
): TodoProjection {
	return updateTodoItem(
		projection,
		workItemId,
		(item) => item.status !== "completed",
		() => ({ status: "stalled" }),
	);
}
