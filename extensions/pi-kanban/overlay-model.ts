/** Pure data preparation for the Kanban overlay view. */

import type { BoardState, TaskState } from "./board.js";

export const COLUMNS = [
	"backlog",
	"todo",
	"in-progress",
	"blocked",
	"done",
] as const;
export type Column = (typeof COLUMNS)[number];
export const DONE_LIMIT = 10;

export interface OverlayViewModel {
	colTasks: TaskState[][];
	activeCol: Column;
	activeRow: number;
	scroll: Record<Column, number>;
	statusMessage: string;
	filterQuery?: string;
	isFiltering?: boolean;
	hiddenDoneCount?: number;
}

function taskMatchesFilter(task: TaskState, query: string): boolean {
	return [task.id, task.title, task.claimAgent, task.agent].some((value) =>
		value.toLowerCase().includes(query),
	);
}

export function tasksInColumn(
	board: BoardState,
	column: Column,
	filterQuery = "",
	limitDone = true,
): TaskState[] {
	const query = filterQuery.trim().toLowerCase();
	const tasks: TaskState[] = [];
	for (const taskId of board.order) {
		const task = board.tasks.get(taskId);
		if (!task || task.deleted || task.col !== column) continue;
		if (query && !taskMatchesFilter(task, query)) continue;
		tasks.push(task);
	}
	if (column !== "done" || !limitDone) return tasks;
	return tasks.slice(-DONE_LIMIT).reverse();
}

/** Builds the renderer input without reading the terminal or filesystem. */
export function buildOverlayViewModel(
	board: BoardState,
	activeCol: Column,
	activeRow: number,
	scroll: Record<Column, number>,
	statusMessage: string,
	filterQuery: string,
	isFiltering: boolean,
): OverlayViewModel {
	const allDone = tasksInColumn(board, "done", filterQuery, false);
	const colTasks = COLUMNS.map((column) =>
		tasksInColumn(board, column, filterQuery),
	);
	const visibleDone = colTasks[COLUMNS.indexOf("done")]?.length ?? 0;
	return {
		colTasks,
		activeCol,
		activeRow,
		scroll,
		statusMessage,
		filterQuery,
		isFiltering,
		hiddenDoneCount: Math.max(0, allDone.length - visibleDone),
	};
}
