/**
 * Kanban board view and column-management tool registrations.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { writeFile } from "node:fs/promises";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import { compactIfNeeded } from "./compaction.js";
import { generateSnapshot } from "./snapshot.js";
import { TASK_ID_SCHEMA } from "./schemas.js";
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

export function registerBoardTools(pi: ExtensionAPI): void {
	// ── kanban_snapshot ─────────────────────────────────────────
	pi.registerTool({
		name: "kanban_snapshot",
		label: "Kanban Snapshot",
		description:
			"Regenerate snapshot.md from board.log and return the full board view. " +
			"Shows all columns: Backlog, Todo, In Progress, Blocked, and Done (last 10). " +
			"Always run this before presenting board status to a human.",
		promptSnippet: "Regenerate and read the kanban board snapshot",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal): Promise<ToolResult> {
			const board = await parseBoard();
			const snapshot = generateSnapshot(board);
			const sp = snapshotPath();
			await writeFile(sp, snapshot, "utf-8");
			await logAppend(`${nowZ()} SNAPSHOT T-SYS orchestrator seq=${board.totalEvents}`);
			// Auto-compaction checkpoint: snapshot is the natural housekeeping moment
			const compactResult = await compactIfNeeded(board, board.totalEvents, "snapshot");
			const compactNote = compactResult.ran
				? `\n\n⚙️ Auto-compacted: ${compactResult.eventsBefore} → ${compactResult.eventsAfter} events (backup created)`
				: "";
			return ok(
				`Snapshot written to ${sp}\nTotal events in log: ${board.totalEvents}${compactNote}\n\n---\n\n${snapshot}`,
				{ snapshotPath: sp, totalEvents: board.totalEvents, autoCompacted: compactResult.ran },
			);
		},
	});

	// ── kanban_unblock ──────────────────────────────────────────
	pi.registerTool({
		name: "kanban_unblock",
		label: "Kanban Unblock",
		description: "Unblock a blocked task and move it to todo. Task must be in the blocked column. Records the resolution reason in the log.",
		promptSnippet: "Unblock a kanban task and move to todo",
		parameters: Type.Object({
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({ description: "Agent name unblocking the task" }),
			reason: Type.Optional(Type.String({ description: 'Resolution reason (e.g. "API key received")', default: "" })),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { task_id, agent } = params;
			const reason = params.reason ?? "";
			const task = await getTask(task_id);
			if (task.col !== "blocked") throw new Error(`Task ${task_id} is in '${task.col}' column, not 'blocked'. Cannot unblock.`);
			const ts = nowZ();
			await logAppend(`${ts} UNBLOCK ${task_id} ${sanitiseAgent(agent)} resolution="${reason}"`);
			await logAppend(`${ts} MOVE ${task_id} ${sanitiseAgent(agent)} from=blocked to=todo`);
			return ok(`Unblocked ${task_id}, moved to todo`, { task_id, agent, reason });
		},
	});

	// ── kanban_move ─────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_move",
		label: "Kanban Move",
		description: "Move a task between backlog and todo columns. Task must not be in in-progress, blocked, or done columns.",
		promptSnippet: "Move a kanban task between backlog and todo",
		parameters: Type.Object({
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({ description: "Agent name moving the task" }),
			to: Type.String({ description: "Target column: backlog | todo", enum: ["backlog", "todo"] }),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { task_id, agent, to } = params;
			const { from, to: toCol } = await moveTask(task_id, agent, to as "backlog" | "todo");
			return ok(`Moved ${task_id} from ${from} to ${toCol}`, { task_id, agent, from, to: toCol });
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
			agent: Type.String({ description: "Agent name performing the deletion (lowercase, hyphens only)" }),
			reason: Type.Optional(Type.String({ description: 'Optional reason for deletion (e.g. "duplicate of T-042", "no longer needed")', default: "" })),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { task_id, agent } = params;
			const reason = params.reason ?? "";
			const { previousCol } = await deleteTask(task_id, agent, reason);
			return ok(
				`Deleted ${task_id} (was in '${previousCol}')${reason ? `: ${reason}` : ""}.\nThe task will no longer appear in kanban_snapshot.`,
				{ task_id, agent, reason, previousCol },
			);
		},
	});
}
