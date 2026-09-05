/** Pure board folding and visibility rules used by snapshot serialization. */

import {
	sortTasksByPriority,
	type BoardState,
	type TaskState,
} from "./board.js";

export const DEFAULT_DONE_MAX_AGE_DAYS = 30;

export interface SnapshotOptions {
	showAllDone?: boolean;
}

interface SnapshotBuckets {
	backlog: TaskState[];
	todo: TaskState[];
	"in-progress": TaskState[];
	blocked: TaskState[];
	done: TaskState[];
}

/** Folds the ordered board state into the five snapshot columns. */
export function bucketSnapshotTasks(board: BoardState): SnapshotBuckets {
	const buckets: SnapshotBuckets = {
		backlog: [],
		todo: [],
		"in-progress": [],
		blocked: [],
		done: [],
	};
	for (const taskId of board.order) {
		const task = board.tasks.get(taskId);
		if (!task || task.deleted) continue;
		switch (task.col) {
			case "backlog":
			case "todo":
			case "in-progress":
			case "blocked":
			case "done":
				buckets[task.col].push(task);
				break;
		}
	}
	buckets.backlog = sortTasksByPriority(buckets.backlog);
	buckets.todo = sortTasksByPriority(buckets.todo);
	buckets["in-progress"] = sortTasksByPriority(buckets["in-progress"]);
	buckets.blocked = sortTasksByPriority(buckets.blocked);
	return buckets;
}

/** Returns done tasks visible at the supplied time, without mutating the board. */
export function visibleDoneTasks(
	tasks: TaskState[],
	options: SnapshotOptions = {},
	nowMs = Date.now(),
): TaskState[] {
	if (options.showAllDone) return tasks;
	const cutoffMs = nowMs - DEFAULT_DONE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
	return tasks.filter((task) => {
		if (!task.completedAt) return true;
		const completedMs = Date.parse(task.completedAt);
		return Number.isNaN(completedMs) || completedMs >= cutoffMs;
	});
}

export function doneCountLabel(
	visible: number,
	total: number,
	prefix?: string,
): string {
	if (visible === total && !prefix) return String(visible);
	const ageNote = visible < total ? `, ${total - visible} older hidden` : "";
	return `${prefix ? `${prefix} ` : ""}${visible} of ${total}${ageNote}`;
}
