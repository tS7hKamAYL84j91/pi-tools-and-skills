/**
 * Cross-process transaction boundary for the authoritative Kanban event log.
 */

import { EventLog, textEventLogCodec } from "../../lib/event-log.js";
import {
	type BoardState,
	boardLogPath,
	escapeLogValue,
	nowZ,
	parseBoard,
	sanitiseAgent,
	validateTaskId,
} from "./board.js";

interface BoardTransactionResult<T> {
	readonly events: readonly string[];
	readonly result: T;
}

/** Lines appended by this process, used by the watcher for self-detection. */
export const selfAppendedLines = new Set<string>();

function boardEventLog(): EventLog<string> {
	return new EventLog(boardLogPath(), { codec: textEventLogCodec });
}

/** Run work while holding the one advisory lock for board.log. */
export async function withBoardLock<T>(fn: () => Promise<T>): Promise<T> {
	return boardEventLog().withLock(fn);
}

async function appendBoardEventsLocked(events: readonly string[]): Promise<void> {
	if (events.length === 0) {
		return;
	}
	const newlyRegistered = events.filter(
		(event) => !selfAppendedLines.has(event),
	);
	for (const event of events) {
		selfAppendedLines.add(event);
	}
	try {
		await boardEventLog().appendLocked(events);
	} catch (error) {
		for (const event of newlyRegistered) {
			selfAppendedLines.delete(event);
		}
		throw error;
	}
}

/** Read, validate, and append one ordered event batch under the board lock. */
export async function withBoardTransaction<T>(
	transaction: (
		board: BoardState,
	) => BoardTransactionResult<T> | Promise<BoardTransactionResult<T>>,
): Promise<T> {
	return withBoardLock(async () => {
		const board = await parseBoard();
		const { events, result } = await transaction(board);
		await appendBoardEventsLocked(events);
		return result;
	});
}

/** Append one ordinary event through the shared board lock. */
export async function logAppend(line: string): Promise<void> {
	await withBoardLock(async () => appendBoardEventsLocked([line]));
}

/** Validate and append a DELETE event atomically. */
export async function deleteTask(
	taskId: string,
	agent: string,
	reason = "",
): Promise<{ task_id: string; previousCol: string; reason: string }> {
	validateTaskId(taskId);
	return withBoardTransaction((board) => {
		const task = board.tasks.get(taskId);
		if (!task) {
			throw new Error(`Task ${taskId} not found`);
		}
		if (task.deleted) {
			throw new Error(`Task ${taskId} has already been deleted`);
		}
		if (task.col === "in-progress") {
			throw new Error(
				`Cannot delete task ${taskId}: it is currently in 'in-progress'. Complete the task before deleting it.`,
			);
		}
		const reasonSuffix = reason ? ` reason="${escapeLogValue(reason)}"` : "";
		return {
			events: [
				`${nowZ()} DELETE ${taskId} ${sanitiseAgent(agent)}${reasonSuffix}`,
			],
			result: { task_id: taskId, previousCol: task.col, reason },
		};
	});
}

/** Validate and append a MOVE event atomically. */
export async function moveTask(
	taskId: string,
	agent: string,
	to: "backlog" | "todo",
): Promise<{ task_id: string; from: string; to: string }> {
	validateTaskId(taskId);
	return withBoardTransaction((board) => {
		const task = board.tasks.get(taskId);
		if (!task) {
			throw new Error(`Task ${taskId} not found`);
		}
		if (["in-progress", "blocked", "done"].includes(task.col)) {
			throw new Error(
				`Cannot move task ${taskId} from '${task.col}' column. Can only move from backlog or todo.`,
			);
		}
		const from = task.col;
		if (from === to) {
			throw new Error(`Task ${taskId} is already in ${to}.`);
		}
		return {
			events: [
				`${nowZ()} MOVE ${taskId} ${sanitiseAgent(agent)} from=${from} to=${to}`,
			],
			result: { task_id: taskId, from, to },
		};
	});
}
