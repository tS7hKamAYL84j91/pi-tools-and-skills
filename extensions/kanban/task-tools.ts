/**
 * Kanban task mutation tool registrations.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import { compactIfNeeded } from "./compaction.js";
import { TASK_ID_SCHEMA } from "./schemas.js";
import {
	appendTaskNote,
	escapeLogValue,
	getTask,
	logAppend,
	nowZ,
	parseBoard,
	rewriteTaskFile,
	sanitiseAgent,
	validateTaskId,
	writeTaskFile,
} from "./board.js";

export function registerTaskTools(pi: ExtensionAPI): void {
	// ── kanban_create ───────────────────────────────────────────
	pi.registerTool({
		name: "kanban_create",
		label: "Kanban Create",
		description:
			"Create a new task in the kanban backlog. " +
			"The task starts in the backlog column. Use kanban_snapshot to view the board afterwards.",
		promptSnippet: "Create a new kanban task in the backlog",
		parameters: Type.Object({
			task_id: Type.String({ description: 'Task ID in T-NNN format (e.g., T-011). Must be unique.' }),
			agent: Type.String({ description: 'Agent name creating the task (lowercase, hyphens only, e.g. "lead")' }),
			title: Type.String({ description: "Human-readable task title" }),
			priority: Type.String({ description: "Task priority: critical | high | medium | low", enum: ["critical", "high", "medium", "low"] }),
			tags: Type.Optional(Type.String({ description: 'Optional comma-separated tags (e.g. "tools,research")', default: "" })),
			description: Type.Optional(Type.String({ description: "Optional longer description — the 'what and why' of the task", default: "" })),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { task_id, agent, title, priority } = params;
			const tags = params.tags ?? "";
			const description = params.description ?? "";
			validateTaskId(task_id);
			const existing = await parseBoard();
			if (existing.tasks.has(task_id)) throw new Error(`Task ID ${task_id} already exists`);
			const descPart = description ? ` description="${escapeLogValue(description)}"` : "";
			await logAppend(`${nowZ()} CREATE ${task_id} ${sanitiseAgent(agent)} title="${escapeLogValue(title)}" priority="${priority}" tags="${escapeLogValue(tags)}"${descPart}`);
			// Write task markdown file
			await writeTaskFile(task_id, { title, description, priority, tags, agent });
			return ok(`Created ${task_id}: ${title} (priority=${priority})`, { task_id, title, priority, tags, description });
		},
	});

	// ── kanban_complete ─────────────────────────────────────────
	pi.registerTool({
		name: "kanban_complete",
		label: "Kanban Complete",
		description: "Mark an in-progress task as done. Optionally provide how long the task took (e.g. '45m', '2h').",
		promptSnippet: "Mark a kanban task as completed",
		parameters: Type.Object({
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({ description: "Agent name that completed the task (must match the claiming agent)" }),
			duration: Type.Optional(Type.String({ description: 'Optional duration string (e.g. "45m", "2h", "107m")', default: "unknown" })),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { task_id, agent } = params;
			const duration = params.duration ?? "unknown";
			const task = await getTask(task_id);
			if (task.col !== "in-progress") throw new Error(`Task ${task_id} is not in-progress (col=${task.col})`);
			const ts = nowZ();
			await logAppend(`${ts} COMPLETE ${task_id} ${sanitiseAgent(agent)} duration=${duration}`);
			await logAppend(`${ts} MOVE ${task_id} ${sanitiseAgent(agent)} from=in-progress to=done`);
			// Auto-compaction checkpoint: completing a task is a natural housekeeping moment
			const boardAfter = await parseBoard();
			await compactIfNeeded(boardAfter, boardAfter.totalEvents, "complete");
			return ok(`Completed ${task_id} (agent=${agent}, duration=${duration})`, { task_id, agent, duration });
		},
	});

	// ── kanban_block ────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_block",
		label: "Kanban Block",
		description:
			"Mark an in-progress task as blocked. Frees the WIP slot and records the reason. " +
			"The orchestrator will see this and can unblock by resolving the dependency.",
		promptSnippet: "Mark a kanban task as blocked with a reason",
		parameters: Type.Object({
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({ description: "Agent name that is blocked" }),
			reason: Type.String({ description: 'Short description of what is needed to unblock (e.g. "waiting for API key from orchestrator")' }),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { task_id, agent, reason } = params;
			const task = await getTask(task_id);
			if (task.col !== "in-progress") throw new Error(`Task ${task_id} is not in-progress (col=${task.col})`);
			const ts = nowZ();
			await logAppend(`${ts} BLOCK ${task_id} ${sanitiseAgent(agent)} reason="${escapeLogValue(reason)}"`);
			await logAppend(`${ts} MOVE ${task_id} ${sanitiseAgent(agent)} from=in-progress to=blocked`);
			return ok(`Blocked ${task_id}: ${reason}`, { task_id, agent, reason });
		},
	});

	// ── kanban_note ─────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_note",
		label: "Kanban Note",
		description: "Append a timestamped progress note to a task. Use for milestones, status updates, and observations. Notes appear in the snapshot under the task.",
		promptSnippet: "Add a progress note to a kanban task",
		parameters: Type.Object({
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({ description: "Agent name adding the note" }),
			text: Type.String({ description: 'Note text (e.g. "core logic done, writing tests")' }),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { task_id, agent, text } = params;
			await logAppend(`${nowZ()} NOTE ${task_id} ${sanitiseAgent(agent)} text="${escapeLogValue(text)}"`);
			// Append note to task markdown file
			await appendTaskNote(task_id, agent, text);
			return ok(`Note added to ${task_id}`, { task_id, agent, text });
		},
	});

	// ── kanban_edit ─────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_edit",
		label: "Kanban Edit",
		description: "Update title, priority, or tags on an existing task. Task must be in backlog or todo (not in-progress, blocked, or done). At least one field must be provided.",
		promptSnippet: "Edit a kanban task's title, priority, or tags",
		parameters: Type.Object({
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({ description: "Agent name performing the edit (lowercase, hyphens only)" }),
			title: Type.Optional(Type.String({ description: "New task title" })),
			priority: Type.Optional(Type.String({ description: "New priority: critical | high | medium | low", enum: ["critical", "high", "medium", "low"] })),
			tags: Type.Optional(Type.String({ description: "New comma-separated tags" })),
			description: Type.Optional(Type.String({ description: "New description for the task" })),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { task_id, agent } = params;
			validateTaskId(task_id);
			if (!params.title && !params.priority && !params.tags && !params.description) throw new Error("At least one of title, priority, tags, or description must be provided");
			const task = await getTask(task_id);
			if (!["backlog", "todo"].includes(task.col)) throw new Error(`Task ${task_id} is in '${task.col}' column. Can only edit tasks in backlog or todo.`);

			const changes: string[] = [];
			const changed: Record<string, string> = {};
			if (params.title && params.title !== task.title) { changes.push(`title="${escapeLogValue(params.title)}"`); changed.title = params.title; }
			if (params.priority && params.priority !== task.priority) { changes.push(`priority="${params.priority}"`); changed.priority = params.priority; }
			if (params.tags && params.tags !== task.tags) { changes.push(`tags="${escapeLogValue(params.tags)}"`); changed.tags = params.tags; }
			if (params.description && params.description !== task.description) { changes.push(`description="${escapeLogValue(params.description)}"`); changed.description = params.description; }
			if (changes.length === 0) return ok(`No changes needed for ${task_id} (values already match)`, { task_id, agent, changed: {} });

			await logAppend(`${nowZ()} EDIT ${task_id} ${sanitiseAgent(agent)} ${changes.join(" ")}`);
			// Update task markdown file with new metadata
			const updatedTask = await getTask(task_id);
			await rewriteTaskFile(task_id, {
				title: updatedTask.title,
				description: updatedTask.description,
				priority: updatedTask.priority,
				tags: updatedTask.tags,
				agent: updatedTask.agent,
			});
			return ok(`Edited ${task_id}: ${changes.join(", ")}`, { task_id, agent, changed });
		},
	});
}
