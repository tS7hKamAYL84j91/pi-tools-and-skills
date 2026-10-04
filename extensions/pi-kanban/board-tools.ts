/**
 * Kanban board view and column-management tool registrations.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import { parseBoard } from "./board.js";
import { unblockTask } from "./board-actions.js";
import {
	deleteTask,
	moveTask,
} from "./board-transactions.js";
import { exportBoardJson } from "./export.js";
import { TASK_ID_SCHEMA } from "./schemas.js";

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
	await unblockTask(task_id, agent, resolvedReason);
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
		`Deleted ${task_id} (was in '${previousCol}')${resolvedReason ? `: ${resolvedReason}` : ""}.\nThe task will no longer appear on the board.`,
		{ task_id, agent, reason: resolvedReason, previousCol },
	);
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
			"appear in board views.",
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
	registerKanbanExportJson(pi);
	registerKanbanUnblock(pi);
	registerKanbanMove(pi);
	registerKanbanDelete(pi);
}
