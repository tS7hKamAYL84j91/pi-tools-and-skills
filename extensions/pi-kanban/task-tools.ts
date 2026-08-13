/**
 * Kanban task mutation tool registrations.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import {
	appendTaskNote,
	escapeLogValue,
	nowZ,
	rewriteTaskFile,
	sanitiseAgent,
	validateTaskId,
	writeTaskFile,
} from "./board.js";
import { withBoardTransaction } from "./board-transactions.js";
import { TASK_ID_SCHEMA } from "./schemas.js";
import { registerKanbanComplete } from "./complete-tool.js";

function registerKanbanCreate(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "kanban_create",
		label: "Kanban Create",
		description:
			"Create a new task in the kanban backlog. " +
			"The task starts in the backlog column. Use kanban_snapshot to view the board afterwards.",
		promptSnippet: "Create a new kanban task in the backlog",
		parameters: Type.Object({
			task_id: Type.String({
				description: "Task ID in T-NNN format (e.g., T-011). Must be unique.",
			}),
			agent: Type.String({
				description:
					'Agent name creating the task (lowercase, hyphens only, e.g. "lead")',
			}),
			title: Type.String({ description: "Human-readable task title" }),
			priority: Type.String({
				description: "Task priority: critical | high | medium | low",
				enum: ["critical", "high", "medium", "low"],
			}),
			tags: Type.Optional(
				Type.String({
					description: 'Optional comma-separated tags (e.g. "tools,research")',
					default: "",
				}),
			),
			description: Type.Optional(
				Type.String({
					description:
						"Optional longer description — the 'what and why' of the task",
					default: "",
				}),
			),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { task_id, agent, title, priority } = params;
			const tags = params.tags ?? "";
			const description = params.description ?? "";
			validateTaskId(task_id);
			await withBoardTransaction((board) => {
				if (board.tasks.has(task_id)) {
					throw new Error(`Task ID ${task_id} already exists`);
				}
				const descPart = description
					? ` description="${escapeLogValue(description)}"`
					: "";
				return {
					events: [
						`${nowZ()} CREATE ${task_id} ${sanitiseAgent(agent)} title="${escapeLogValue(title)}" priority="${priority}" tags="${escapeLogValue(tags)}"${descPart}`,
					],
					result: undefined,
				};
			});
			// Write task markdown file
			await writeTaskFile(task_id, {
				title,
				description,
				priority,
				tags,
				agent,
			});
			return ok(`Created ${task_id}: ${title} (priority=${priority})`, {
				task_id,
				title,
				priority,
				tags,
				description,
			});
		},
	});
}

function registerKanbanBlock(pi: ExtensionAPI): void {
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
			reason: Type.String({
				description:
					'Short description of what is needed to unblock (e.g. "waiting for API key from orchestrator")',
			}),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { task_id, agent, reason } = params;
			await withBoardTransaction((board) => {
				const task = board.tasks.get(task_id);
				if (!task) {
					throw new Error(`Task ${task_id} not found`);
				}
				if (task.col !== "in-progress") {
					throw new Error(
						`Task ${task_id} is not in-progress (col=${task.col})`,
					);
				}
				const timestamp = nowZ();
				const safeAgent = sanitiseAgent(agent);
				return {
					events: [
						`${timestamp} BLOCK ${task_id} ${safeAgent} reason="${escapeLogValue(reason)}"`,
						`${timestamp} MOVE ${task_id} ${safeAgent} from=in-progress to=blocked`,
					],
					result: undefined,
				};
			});
			return ok(`Blocked ${task_id}: ${reason}`, { task_id, agent, reason });
		},
	});
}

// ── Unified Update Logic ────────────────────────────────────

async function performEdit(
	task_id: string,
	agent: string,
	options: {
		title?: string;
		priority?: string;
		tags?: string;
		description?: string;
		note?: string;
	},
): Promise<ToolResult> {
	validateTaskId(task_id);
	const { title, priority, tags, description, note } = options;
	if (!title && !priority && !tags && !description && !note) {
		throw new Error(
			"At least one of title, priority, tags, description, or note must be provided",
		);
	}

	const hasMetadataEdits = Boolean(title || priority || tags || description);
	const mutation = await withBoardTransaction((board) => {
		const task = board.tasks.get(task_id);
		if (!task) {
			throw new Error(`Task ${task_id} not found`);
		}
		if (hasMetadataEdits && !["backlog", "todo"].includes(task.col)) {
			throw new Error(
				`Task ${task_id} is in '${task.col}' column. Metadata edits (title/priority/tags/description) are only allowed for tasks in backlog or todo. Use notes (note=...) for in-progress, blocked, or done tasks.`,
			);
		}

		const changes: string[] = [];
		const changed: Record<string, string> = {};
		if (title && title !== task.title) {
			changes.push(`title="${escapeLogValue(title)}"`);
			changed.title = title;
		}
		if (priority && priority !== task.priority) {
			changes.push(`priority="${priority}"`);
			changed.priority = priority;
		}
		if (tags && tags !== task.tags) {
			changes.push(`tags="${escapeLogValue(tags)}"`);
			changed.tags = tags;
		}
		if (description && description !== task.description) {
			changes.push(`description="${escapeLogValue(description)}"`);
			changed.description = description;
		}
		if (note) {
			changed.note = note;
		}

		const timestamp = nowZ();
		const safeAgent = sanitiseAgent(agent);
		const events: string[] = [];
		if (changes.length > 0) {
			events.push(`${timestamp} EDIT ${task_id} ${safeAgent} ${changes.join(" ")}`);
		}
		if (note) {
			events.push(
				`${timestamp} NOTE ${task_id} ${safeAgent} text="${escapeLogValue(note)}"`,
			);
		}
		return {
			events,
			result: {
				changed,
				changes,
				metadata:
					changes.length > 0
						? {
								title: changed.title ?? task.title,
								description: changed.description ?? task.description,
								priority: changed.priority ?? task.priority,
								tags: changed.tags ?? task.tags,
								agent: task.agent,
							}
						: undefined,
			},
		};
	});
	const { changed, changes, metadata } = mutation;
	if (metadata) {
		await rewriteTaskFile(task_id, metadata);
	}
	if (note) {
		await appendTaskNote(task_id, agent, note);
	}

	if (changes.length === 0 && !note) {
		return ok(`No changes needed for ${task_id} (values already match)`, {
			task_id,
			agent,
			changed: {},
		});
	}

	const msgParts = [];
	if (changes.length > 0) msgParts.push(`Edited ${changes.join(", ")}`);
	if (note) msgParts.push("Added note");

	return ok(`${msgParts.join(" and ")} for ${task_id}`, {
		task_id,
		agent,
		changed,
	});
}

function registerKanbanEdit(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "kanban_edit",
		label: "Kanban Edit",
		description:
			"Update title, priority, tags, description, or add a progress note to an existing task. Notes can be added to any task. Metadata (title/etc) can only be edited on backlog or todo tasks.",
		promptSnippet: "Edit a kanban task's metadata or add a note",
		parameters: Type.Object({
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({
				description:
					"Agent name performing the update (lowercase, hyphens only)",
			}),
			title: Type.Optional(Type.String({ description: "New task title" })),
			priority: Type.Optional(
				Type.String({
					description: "New priority: critical | high | medium | low",
					enum: ["critical", "high", "medium", "low"],
				}),
			),
			tags: Type.Optional(
				Type.String({ description: "New comma-separated tags" }),
			),
			description: Type.Optional(
				Type.String({ description: "New description for the task" }),
			),
			note: Type.Optional(
				Type.String({
					description:
						"Progress note to append to the task (e.g. status updates, observations)",
				}),
			),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			return performEdit(params.task_id, params.agent, params);
		},
	});
}

export function registerTaskTools(pi: ExtensionAPI): void {
	registerKanbanCreate(pi);
	registerKanbanComplete(pi);
	registerKanbanBlock(pi);
	registerKanbanEdit(pi);
}
