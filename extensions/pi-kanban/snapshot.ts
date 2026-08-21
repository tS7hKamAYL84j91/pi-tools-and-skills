/**
 * Kanban snapshot renderer.
 *
 * Generates Markdown views from BoardState — pure functions with no side
 * effects. The snapshot tool writes the full result to disk but returns the
 * compact summary to preserve gradual disclosure in model context.
 */

import type { BoardState, TaskState } from "./board.js";
import { nowZ, WIP_LIMIT } from "./board.js";
import {
	bucketSnapshotTasks,
	DEFAULT_DONE_MAX_AGE_DAYS,
	doneCountLabel,
	type SnapshotOptions,
	visibleDoneTasks,
} from "./snapshot-model.js";

// ── Column definitions ──────────────────────────────────────────

interface ColumnDef {
	heading: string;
	headers: string[];
	separators: string[];
	row: (t: TaskState) => string;
}

const PRIO_COL_ROW = (t: TaskState) =>
	`| ${t.id} | ${t.title} | ${t.priority} | ${t.tags} |`;

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
		row: (t) =>
			`| ${t.id} | ${t.title} | ${t.claimAgent} | ${t.model || "—"} | ${t.expires} |`,
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
		row: (t) =>
			`| ${t.id} | ${t.title} | ${t.doneAgent || "—"} | ${t.completedAt || "—"} | ${t.duration || "—"} |`,
	},
};

const SUMMARY_LIMITS: Record<string, number> = {
	backlog: 5,
	todo: 5,
	"in-progress": 10,
	blocked: 10,
	done: 5,
};

function truncateInlineDetail(value: string, maxLength: number): string {
	return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function renderSummaryColumn(
	tasks: TaskState[],
	colKey: string,
	countLabel?: string,
): string[] {
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
			const reasonSuffix =
				colKey === "blocked" && task.reason
					? ` (${truncateInlineDetail(task.reason, 80)})`
					: "";
			lines.push(`- ${task.id}: ${task.title}${suffix}${reasonSuffix}`);
		}
		if (omitted > 0) {
			lines.push(
				`- … ${omitted} more. Use kanban_snapshot with task_id="T-NNN" or detail="full" for details.`,
			);
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
	if (task.verificationRequired || task.checks.length > 0) {
		lines.push(
			`- Verification required: ${task.verificationRequired ? "yes" : "no"}`,
			"",
		);
		if (task.checks.length > 0) {
			lines.push("## Verification evidence", "");
			for (const check of task.checks) {
				lines.push(
					`- command: ${check.command}`,
					`  result: ${check.result}`,
					`  exit_code: ${check.exitCode}`,
				);
			}
			lines.push("");
		}
	}
	if (task.description) lines.push("## Description", "", task.description, "");
	if (task.notes.length > 0)
		lines.push("## Notes", "", ...task.notes.map((note) => `- ${note}`), "");
	return lines;
}

function renderColumn(
	tasks: TaskState[],
	colKey: string,
	countLabel: string,
): string[] {
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
	if (!task || task.deleted)
		throw new Error(`No active kanban task: ${taskId}`);
	return taskDetailLines(task).join("\n");
}

/** Generate a compact Markdown summary suitable for model context. */
export function generateSnapshotSummary(
	board: BoardState,
	options?: SnapshotOptions,
): string {
	const { totalEvents } = board;
	const now = nowZ();
	const buckets = bucketSnapshotTasks(board);
	const wip = buckets["in-progress"]?.length ?? 0;
	const doneAll = buckets.done ?? [];
	const doneVisible = visibleDoneTasks(doneAll, options);
	const doneLast = doneVisible.slice(-(SUMMARY_LIMITS.done ?? 5));
	const doneLabel =
		doneVisible.length > doneLast.length
			? doneCountLabel(doneLast.length, doneAll.length, "last")
			: doneCountLabel(doneVisible.length, doneAll.length);
	return [
		"# Kanban — Compact Summary",
		`_Generated: ${now} | Log events: ${totalEvents} | WIP: ${wip}/${WIP_LIMIT}_`,
		`_Done shows tasks completed in the last ${DEFAULT_DONE_MAX_AGE_DAYS} days by default; pass show_all_done=true to include older completed tasks._`,
		'_Gradual disclosure: task descriptions/notes are not included here. Use kanban_snapshot with task_id="T-NNN" for one card or detail="full" for the whole board._',
		"",
		...renderSummaryColumn(buckets.backlog ?? [], "backlog"),
		...renderSummaryColumn(buckets.todo ?? [], "todo"),
		...renderSummaryColumn(buckets["in-progress"] ?? [], "in-progress"),
		...renderSummaryColumn(buckets.blocked ?? [], "blocked"),
		...renderSummaryColumn(doneLast, "done", doneLabel),
		"---",
		"_Full snapshot was written to pi-kanban/snapshot.md but intentionally not returned to model context._",
	].join("\n");
}

/** Generate a full Markdown snapshot from parsed board state. */
export function generateSnapshot(
	board: BoardState,
	options?: SnapshotOptions,
): string {
	const { totalEvents } = board;
	const now = nowZ();
	const buckets = bucketSnapshotTasks(board);
	const wip = buckets["in-progress"]?.length ?? 0;
	const doneAll = buckets.done ?? [];
	const doneVisible = visibleDoneTasks(doneAll, options);
	const doneLast10 = doneVisible.slice(-10);
	const doneLabel =
		doneVisible.length > doneLast10.length
			? doneCountLabel(doneLast10.length, doneAll.length, "last")
			: doneCountLabel(doneVisible.length, doneAll.length);

	return [
		"# Kanban — Snapshot",
		`_Generated: ${now} | Log events: ${totalEvents} | WIP: ${wip}/${WIP_LIMIT}_`,
		`_Done shows tasks completed in the last ${DEFAULT_DONE_MAX_AGE_DAYS} days by default; pass show_all_done=true to include older completed tasks._`,
		"",
		...renderColumn(
			buckets.backlog ?? [],
			"backlog",
			String(buckets.backlog?.length ?? 0),
		),
		...renderColumn(
			buckets.todo ?? [],
			"todo",
			String(buckets.todo?.length ?? 0),
		),
		...renderColumn(
			buckets["in-progress"] ?? [],
			"in-progress",
			`${wip}/${WIP_LIMIT}`,
		),
		...renderColumn(
			buckets.blocked ?? [],
			"blocked",
			String(buckets.blocked?.length ?? 0),
		),
		...renderColumn(doneLast10, "done", doneLabel),
		"---",
		"_Source: pi-kanban/board.log | Read-only: do not edit this file_",
	].join("\n");
}
