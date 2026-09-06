/**
 * Kanban board view and column-management tool registrations.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import { nowZ, parseBoard, sanitiseAgent, snapshotPath } from "./board.js";
import {
	deleteTask,
	moveTask,
	withBoardTransaction,
} from "./board-transactions.js";
import { exportBoardJson } from "./export.js";
import { TASK_ID_SCHEMA } from "./schemas.js";
import {
	generateSnapshot,
	generateSnapshotSummary,
	generateTaskDetail,
} from "./snapshot.js";

interface SnapshotOptions {
	detail?: string;
	task_id?: string;
	show_all_done?: boolean;
}

function renderSnapshot(board: Awaited<ReturnType<typeof parseBoard>>, options: SnapshotOptions) {
	const view = options.task_id ? "task" : (options.detail ?? "compact");
	return { view, text: selectSnapshotView(board, view, { showAllDone: options.show_all_done ?? false }, options.task_id) };
}

async function executeSnapshot(options: SnapshotOptions): Promise<ToolResult> {
	const board = await parseBoard();
	const { view, text } = renderSnapshot(board, options);
	return ok(`View: ${view}\nTotal events in log: ${board.totalEvents}\n\n${text}`, { totalEvents: board.totalEvents, view, readOnly: true });
}

async function executeSnapshotExport(options: SnapshotOptions): Promise<ToolResult> {
	return withBoardTransaction(async (board) => {
		const { view, text } = renderSnapshot(board, options);
		const path = snapshotPath();
		await writeFileAtomic(path, text);
		return {
			events: [`${nowZ()} SNAPSHOT T-SYS orchestrator seq=${board.totalEvents}`],
			result: ok(`Snapshot written to ${path}\nView: ${view}\n\n${text}`, { snapshotPath: path, totalEvents: board.totalEvents, view }),
		};
	});
}

function selectSnapshotView(
	board: Awaited<ReturnType<typeof parseBoard>>,
	view: string,
	options: { showAllDone: boolean },
	taskId?: string,
): string {
	if (taskId) return generateTaskDetail(board, taskId);
	if (view === "full") return generateSnapshot(board, options);
	return generateSnapshotSummary(board, options);
}

async function executeExportJson(): Promise<ToolResult> {
	const board = await parseBoard();
	const exported = exportBoardJson(board);
	return ok(JSON.stringify(exported, null, 2), { ...exported });
}

async function executeUnblock(
	task_id: string,
	agent: string,
	reason?: string,
): Promise<ToolResult> {
	const resolvedReason = reason ?? "";
	await withBoardTransaction((board) => {
		const task = board.tasks.get(task_id);
		if (!task) {
			throw new Error(`Task ${task_id} not found`);
		}
		if (task.col !== "blocked") {
			throw new Error(
				`Task ${task_id} is in '${task.col}' column, not 'blocked'. Cannot unblock.`,
			);
		}
		const timestamp = nowZ();
		const safeAgent = sanitiseAgent(agent);
		return {
			events: [
				`${timestamp} UNBLOCK ${task_id} ${safeAgent} resolution="${resolvedReason}"`,
				`${timestamp} MOVE ${task_id} ${safeAgent} from=blocked to=todo`,
			],
			result: undefined,
		};
	});
	return ok(`Unblocked ${task_id}, moved to todo`, {
		task_id,
		agent,
		reason: resolvedReason,
	});
}

async function executeMove(
	task_id: string,
	agent: string,
	to: string,
): Promise<ToolResult> {
	const { from, to: toCol } = await moveTask(
		task_id,
		agent,
		to as "backlog" | "todo",
	);
	return ok(`Moved ${task_id} from ${from} to ${toCol}`, {
		task_id,
		agent,
		from,
		to: toCol,
	});
}

async function executeDelete(
	task_id: string,
	agent: string,
	reason?: string,
): Promise<ToolResult> {
	const resolvedReason = reason ?? "";
	const { previousCol } = await deleteTask(task_id, agent, resolvedReason);
	return ok(
		`Deleted ${task_id} (was in '${previousCol}')${resolvedReason ? `: ${resolvedReason}` : ""}.\nThe task will no longer appear in kanban_snapshot.`,
		{ task_id, agent, reason: resolvedReason, previousCol },
	);
}

function registerKanbanSnapshot(pi: ExtensionAPI): void {
	const parameters = Type.Object({
			detail: Type.Optional(
				Type.String({
					description: 'Return view: "compact" (default) or "full"',
					enum: ["compact", "full"],
					default: "compact",
				}),
			),
			task_id: Type.Optional(TASK_ID_SCHEMA),
			show_all_done: Type.Optional(
				Type.Boolean({
					description:
						"Include completed tasks older than the default Done age window",
					default: false,
				}),
			),
	});
	pi.registerTool({
		name: "kanban_snapshot",
		label: "View Kanban",
		description: "Read a compact board summary, full board (detail=full), or one card (task_id). No file writes, board events or compaction. Done is age-filtered unless show_all_done=true.",
		promptSnippet: "Read the kanban board or one task without changing files",
		parameters,
		async execute(_id, params): Promise<ToolResult> { return executeSnapshot(params); },
	});
	pi.registerTool({
		name: "kanban_export",
		label: "Export Kanban Snapshot",
		description: "Explicitly write a Markdown snapshot.md and record its SNAPSHOT event. Uses the same compact/full/task views as kanban_snapshot. Does not compact the board.",
		promptSnippet: "Explicitly export a kanban Markdown snapshot",
		parameters,
		async execute(_id, params): Promise<ToolResult> { return executeSnapshotExport(params); },
	});
}

function registerKanbanExportJson(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "kanban_export_json",
		label: "Kanban Export JSON",
		description:
			"Read-only JSON export of active kanban tasks and column counts. Does not write snapshot files or append board events.",
		promptSnippet: "Export the active kanban board as JSON",
		parameters: Type.Object({}),
		async execute(): Promise<ToolResult> {
			return executeExportJson();
		},
	});
}

function registerKanbanUnblock(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "kanban_unblock",
		label: "Kanban Unblock",
		description:
			"Unblock a blocked task and move it to todo. Task must be in the blocked column. Records the resolution reason in the log.",
		promptSnippet: "Unblock a kanban task and move to todo",
		parameters: Type.Object({
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({ description: "Agent name unblocking the task" }),
			reason: Type.Optional(
				Type.String({
					description: 'Resolution reason (e.g. "API key received")',
					default: "",
				}),
			),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			return executeUnblock(params.task_id, params.agent, params.reason);
		},
	});
}

function registerKanbanMove(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "kanban_move",
		label: "Kanban Move",
		description:
			"Move a task between backlog and todo columns. Task must not be in in-progress, blocked, or done columns.",
		promptSnippet: "Move a kanban task between backlog and todo",
		parameters: Type.Object({
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({ description: "Agent name moving the task" }),
			to: Type.String({
				description: "Target column: backlog | todo",
				enum: ["backlog", "todo"],
			}),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			return executeMove(params.task_id, params.agent, params.to);
		},
	});
}

function registerKanbanDelete(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "kanban_delete",
		label: "Kanban Delete",
		description:
			"Soft-delete a kanban task from the board by appending a DELETE event. " +
			"Blocked tasks may be deleted after confirmation; in-progress tasks cannot be deleted. " +
			"The deletion is recorded in board.log for audit purposes and the task will no longer " +
			"appear in kanban_snapshot output.",
		promptSnippet: "Delete a kanban task from the board",
		parameters: Type.Object({
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({
				description:
					"Agent name performing the deletion (lowercase, hyphens only)",
			}),
			reason: Type.Optional(
				Type.String({
					description:
						'Optional reason for deletion (e.g. "duplicate of T-042", "no longer needed")',
					default: "",
				}),
			),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			return executeDelete(params.task_id, params.agent, params.reason);
		},
	});
}

export function registerBoardTools(pi: ExtensionAPI): void {
	registerKanbanSnapshot(pi);
	registerKanbanExportJson(pi);
	registerKanbanUnblock(pi);
	registerKanbanMove(pi);
	registerKanbanDelete(pi);
}
