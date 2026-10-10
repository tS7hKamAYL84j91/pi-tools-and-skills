/**
 * Cross-process transaction boundary for the authoritative Kanban event log.
 *
 * Only this module appends to board.events.jsonl. Shared mutation semantics
 * live in board-actions.ts (and claim-tools.ts for claim conflict handling).
 */

import { EventLog } from "../../lib/event-log.js";
import { kanbanEventCodec, makeEvent, type KanbanEvent } from "./board-events.js";
import {
	type BoardState,
	boardLogPath,
	nowZ,
	parseBoard,
	sanitiseAgent,
	validateTaskId,
} from "./board.js";

interface BoardTransactionResult<T> {
	readonly events: readonly KanbanEvent[];
	readonly result: T;
}

/** Encoded lines appended by this process, used by the watcher for self-detection. */
export const selfAppendedLines = new Set<string>();

function boardEventLog(): EventLog<KanbanEvent> {
	return new EventLog<KanbanEvent>(boardLogPath(), { codec: kanbanEventCodec });
}

/** Run work while holding the one advisory lock for board.events.jsonl. */
export async function withBoardLock<T>(fn: () => Promise<T>): Promise<T> {
	return boardEventLog().withLock(fn);
}

async function appendBoardEventsLocked(events: readonly KanbanEvent[]): Promise<void> {
	if (events.length === 0) {
		return;
	}
	const encoded = events.map((event) => kanbanEventCodec.encode(event));
	const newlyRegistered = encoded.filter((line) => !selfAppendedLines.has(line));
	for (const line of encoded) {
		selfAppendedLines.add(line);
	}
	try {
		await boardEventLog().appendLocked(events);
	} catch (error) {
		for (const line of newlyRegistered) {
			selfAppendedLines.delete(line);
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
export async function logAppend(event: KanbanEvent): Promise<void> {
	await withBoardLock(async () => appendBoardEventsLocked([event]));
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
		const event = makeEvent(
			"delete",
			{ ts: nowZ(), task_id: taskId, agent: sanitiseAgent(agent) },
			{ ...(reason ? { reason } : {}) },
		);
		return {
			events: [event],
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
		const event = makeEvent(
			"move",
			{ ts: nowZ(), task_id: taskId, agent: sanitiseAgent(agent) },
			{ from, to },
		);
		return {
			events: [event],
			result: { task_id: taskId, from, to },
		};
	});
}
