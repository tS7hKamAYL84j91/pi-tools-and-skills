/**
 * Kanban snapshot renderer.
 *
 * Generates Markdown views from BoardState — pure functions with no side
 * effects. The snapshot tool writes the full result to disk but returns the
 * compact summary to preserve gradual disclosure in model context.
 */

import type { BoardState, TaskState } from "./board.js";
import { WIP_LIMIT, nowZ } from "./board.js";

// ── Column definitions ──────────────────────────────────────────

interface ColumnDef {
	heading: string;
	headers: string[];
	separators: string[];
	row: (t: TaskState) => string;
}

const PRIO_COL_ROW = (t: TaskState) => `| ${t.id} | ${t.title} | ${t.priority} | ${t.tags} |`;

const PRIO_COL_HDR: ColumnDef = {
	heading: "",
	headers: ["| ID | Title | Priority | Tags |"],
	separators: ["|----|-------|----------|------|"],
	row: PRIO_COL_ROW,
};

const COLUMN_DEFS: Record<string, ColumnDef> = {
	backlog: { ...PRIO_COL_HDR, heading: "📋 Backlog" },
	todo: { ...PRIO_COL_HDR, heading: "🔜 Todo" },
	"in-progress": {
		heading: "🔄 In Progress",
		headers: ["| ID | Title | Agent | Model | Expires |"],
		separators: ["|----|-------|-------|-------|---------|"],
		row: (t) => `| ${t.id} | ${t.title} | ${t.claimAgent} | ${t.model || "—"} | ${t.expires} |`,
	},
	blocked: {
		heading: "🚫 Blocked",
		headers: ["| ID | Title | Reason |"],
		separators: ["|----|-------|--------|"],
		row: (t) => `| ${t.id} | ${t.title} | ${t.reason} |`,
	},
	done: {
		heading: "✅ Done",
		headers: ["| ID | Title | Agent | Completed | Duration |"],
		separators: ["|----|-------|-------|-----------|----------|"],
		row: (t) => `| ${t.id} | ${t.title} | ${t.doneAgent || "—"} | ${t.completedAt || "—"} | ${t.duration || "—"} |`,
	},
};

const SUMMARY_LIMITS: Record<string, number> = {
	backlog: 5,
	todo: 5,
	"in-progress": 10,
	blocked: 10,
	done: 5,
};

function bucketTasks(board: BoardState): Record<string, TaskState[]> {
	const buckets: Record<string, TaskState[]> = {
		backlog: [], todo: [], "in-progress": [], blocked: [], done: [],
	};
	for (const tid of board.order) {
		const t = board.tasks.get(tid);
		if (!t || t.deleted) continue;
		buckets[t.col]?.push(t);
	}
	return buckets;
}

function renderSummaryColumn(tasks: TaskState[], colKey: string, countLabel?: string): string[] {
	const def = COLUMN_DEFS[colKey];
	if (!def) return [];
	const limit = SUMMARY_LIMITS[colKey] ?? 5;
	const visible = tasks.slice(0, limit);
	const omitted = Math.max(0, tasks.length - visible.length);
	const label = countLabel ?? String(tasks.length);
	const lines = [`## ${def.heading} (${label})`];
	if (visible.length === 0) {
		lines.push("_empty_");
	} else {
		for (const task of visible) {
			const owner = task.claimAgent || task.doneAgent || task.agent;
			const suffix = owner ? ` — ${owner}` : "";
			lines.push(`- ${task.id}: ${task.title}${suffix}`);
		}
		if (omitted > 0) {
			lines.push(`- … ${omitted} more. Use kanban_snapshot with task_id="T-NNN" or detail="full" for details.`);
		}
	}
	lines.push("");
	return lines;
}

/** Render full detail for one task. */
function taskDetailLines(task: TaskState): string[] {
	const lines = [
		`# Kanban Task ${task.id}`,
		"",
		`- Title: ${task.title}`,
		`- Column: ${task.col}`,
		`- Priority: ${task.priority}`,
		`- Tags: ${task.tags || "—"}`,
		`- Agent: ${task.claimAgent || task.doneAgent || task.agent || "—"}`,
		`- Model: ${task.model || "—"}`,
		`- Created: ${task.createdAt || "—"}`,
		`- Completed: ${task.completedAt || "—"}`,
		`- Duration: ${task.duration || "—"}`,
		`- Blocked reason: ${task.reason || "—"}`,
		"",
	];
	if (task.description) lines.push("## Description", "", task.description, "");
	if (task.notes.length > 0) lines.push("## Notes", "", ...task.notes.map((note) => `- ${note}`), "");
	return lines;
}

function renderColumn(tasks: TaskState[], colKey: string, countLabel: string): string[] {
	const def = COLUMN_DEFS[colKey];
	if (!def) return [];
	const lines: string[] = [];

	lines.push(`## ${def.heading} (${countLabel})`);
	if (tasks.length === 0) {
		lines.push("_empty_");
	} else {
		lines.push(...def.headers, ...def.separators);
		for (const t of tasks) lines.push(def.row(t));
	}

	for (const t of tasks.filter((t) => t.description || t.notes.length > 0)) {
		const noteBullets: string[] = [];
		if (t.description) noteBullets.push(`- Description: ${t.description}`);
		noteBullets.push(...t.notes.map((n) => `- ${n}`));
		lines.push("", `**Notes for ${t.id}:**`, ...noteBullets);
	}
	lines.push("");
	return lines;
}

/** Generate detail for one task on explicit request. */
export function generateTaskDetail(board: BoardState, taskId: string): string {
	const task = board.tasks.get(taskId);
	if (!task || task.deleted) throw new Error(`No active kanban task: ${taskId}`);
	return taskDetailLines(task).join("\n");
}

/** Generate a compact Markdown summary suitable for model context. */
export function generateSnapshotSummary(board: BoardState): string {
	const { totalEvents } = board;
	const now = nowZ();
	const buckets = bucketTasks(board);
	const wip = buckets["in-progress"]?.length ?? 0;
	const doneAll = buckets.done ?? [];
	const doneLast = doneAll.slice(-(SUMMARY_LIMITS.done ?? 5));
	return [
		"# CoAS Kanban — Compact Summary",
		`_Generated: ${now} | Log events: ${totalEvents} | WIP: ${wip}/${WIP_LIMIT}_`,
		"_Gradual disclosure: task descriptions/notes are not included here. Use kanban_snapshot with task_id=\"T-NNN\" for one card or detail=\"full\" for the whole board._",
		"",
		...renderSummaryColumn(buckets.backlog ?? [], "backlog"),
		...renderSummaryColumn(buckets.todo ?? [], "todo"),
		...renderSummaryColumn(buckets["in-progress"] ?? [], "in-progress"),
		...renderSummaryColumn(buckets.blocked ?? [], "blocked"),
		...renderSummaryColumn(doneLast, "done", `last ${doneLast.length} of ${doneAll.length}`),
		"---",
		"_Full snapshot was written to kanban/snapshot.md but intentionally not returned to model context._",
	].join("\n");
}

/** Generate a full Markdown snapshot from parsed board state. */
export function generateSnapshot(board: BoardState): string {
	const { totalEvents } = board;
	const now = nowZ();
	const buckets = bucketTasks(board);
	const wip = buckets["in-progress"]?.length ?? 0;
	const doneAll = buckets.done ?? [];
	const doneLast10 = doneAll.slice(-10);

	return [
		"# CoAS Kanban — Snapshot",
		`_Generated: ${now} | Log events: ${totalEvents} | WIP: ${wip}/${WIP_LIMIT}_`,
		"",
		...renderColumn(buckets.backlog ?? [], "backlog", String(buckets.backlog?.length ?? 0)),
		...renderColumn(buckets.todo ?? [], "todo", String(buckets.todo?.length ?? 0)),
		...renderColumn(buckets["in-progress"] ?? [], "in-progress", `${wip}/${WIP_LIMIT}`),
		...renderColumn(buckets.blocked ?? [], "blocked", String(buckets.blocked?.length ?? 0)),
		...renderColumn(doneLast10, "done", `last 10 of ${doneAll.length}`),
		"---",
		"_Source: kanban/board.log | Read-only: do not edit this file_",
	].join("\n");
}
