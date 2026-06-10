/**
 * Kanban board view and column-management tool registrations.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import {
	deleteTask,
	getTask,
	logAppend,
	moveTask,
	nowZ,
	parseBoard,
	sanitiseAgent,
	snapshotPath,
} from "./board.js";
import { compactIfNeeded } from "./compaction.js";
import { exportBoardJson } from "./export.js";
import { TASK_ID_SCHEMA } from "./schemas.js";
import {
	generateSnapshot,
	generateSnapshotSummary,
	generateTaskDetail,
} from "./snapshot.js";

async function executeSnapshot(
	detail?: string,
	task_id?: string,
	show_all_done?: boolean,
): Promise<ToolResult> {
	const board = await parseBoard();
	const snapshotOptions = { showAllDone: show_all_done ?? false };
	const snapshot = generateSnapshot(board, snapshotOptions);
	const view = task_id ? "task" : (detail ?? "compact");
	let returnedView: string;
	if (task_id) {
		returnedView = generateTaskDetail(board, task_id);
	} else if (view === "full") {
		returnedView = snapshot;
	} else {
		returnedView = generateSnapshotSummary(board, snapshotOptions);
	}
	const sp = snapshotPath();
	await writeFileAtomic(sp, snapshot);
	await logAppend(
		`${nowZ()} SNAPSHOT T-SYS orchestrator seq=${board.totalEvents}`,
	);
	// Auto-compaction checkpoint: snapshot is the natural housekeeping moment
	const compactResult = await compactIfNeeded(
		board,
		board.totalEvents,
		"snapshot",
	);
	const compactNote = compactResult.ran
		? `\n\n⚙️ Auto-compacted: ${compactResult.eventsBefore} → ${compactResult.eventsAfter} events (backup created)`
		: "";
	return ok(
		`Snapshot written to ${sp}\nTotal events in log: ${board.totalEvents}\nReturned view: ${view}${compactNote}\n\n---\n\n${returnedView}`,
		{
			snapshotPath: sp,
			totalEvents: board.totalEvents,
			autoCompacted: compactResult.ran,
			view,
		},
	);
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
	const task = await getTask(task_id);
	if (task.col !== "blocked")
		throw new Error(
			`Task ${task_id} is in '${task.col}' column, not 'blocked'. Cannot unblock.`,
		);
	const ts = nowZ();
	await logAppend(
		`${ts} UNBLOCK ${task_id} ${sanitiseAgent(agent)} resolution="${resolvedReason}"`,
	);
	await logAppend(
		`${ts} MOVE ${task_id} ${sanitiseAgent(agent)} from=blocked to=todo`,
	);
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

export function registerBoardTools(pi: ExtensionAPI): void {
	// ── kanban_snapshot ─────────────────────────────────────────
	pi.registerTool({
		name: "kanban_snapshot",
		label: "Kanban Snapshot",
		description:
			"Regenerate snapshot.md from board.log and return a compact board summary by default. " +
			"Done is age-filtered by default; pass show_all_done=true for all completed tasks. " +
			'Uses gradual disclosure: pass detail="full" for the full board or task_id for one card\'s details.',
		promptSnippet:
			"Regenerate the kanban board snapshot and return a compact summary",
		parameters: Type.Object({
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
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			return executeSnapshot(
				params.detail,
				params.task_id,
				params.show_all_done,
			);
		},
	});

	// ── kanban_export_json ───────────────────────────────────────
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

	// ── kanban_unblock ──────────────────────────────────────────
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

	// ── kanban_move ─────────────────────────────────────────────
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

	// ── kanban_delete ───────────────────────────────────────────
	pi.registerTool({
		name: "kanban_delete",
		label: "Kanban Delete",
		description:
			"Permanently remove a kanban task from the board by appending a DELETE event. " +
			"Tasks that are in-progress or blocked cannot be deleted — complete or unblock them first. " +
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
