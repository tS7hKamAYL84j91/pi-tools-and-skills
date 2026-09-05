/** Pure selection and scrolling rules used by the Kanban overlay controller. */

import type { TaskState } from "./board.js";

/** Returns the selected task identity for a rendered task list. */
export function selectedTaskId(
	tasks: TaskState[],
	activeRow: number,
): string | undefined {
	return tasks[activeRow]?.id;
}

/** Keeps an existing task selected, falling back to a valid row when absent. */
export function restoreSelectedRow(
	tasks: TaskState[],
	preferredId: string | undefined,
	fallbackRow: number,
): number {
	if (preferredId) {
		const selectedIndex = tasks.findIndex((task) => task.id === preferredId);
		if (selectedIndex >= 0) return selectedIndex;
	}
	if (tasks.length === 0) return 0;
	return Math.min(Math.max(0, fallbackRow), tasks.length - 1);
}

/** Clamps an offset while keeping the active row inside the visible window. */
export function clampScrollOffset(
	taskCount: number,
	activeRow: number,
	visibleRows: number,
	offset: number,
): number {
	if (taskCount === 0 || visibleRows <= 0) return 0;
	const maxOffset = Math.max(0, taskCount - visibleRows);
	let nextOffset = Math.min(Math.max(0, offset), maxOffset);
	if (activeRow < nextOffset) nextOffset = activeRow;
	if (activeRow >= nextOffset + visibleRows) {
		nextOffset = activeRow - visibleRows + 1;
	}
	return Math.min(nextOffset, maxOffset);
}
