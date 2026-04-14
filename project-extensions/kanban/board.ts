/**
 * Kanban board state — parser, types, and path helpers.
 *
 * Reads board.log and produces a BoardState with all tasks
 * bucketed by column. Pure event-sourcing: each log line is
 * an event that mutates a TaskState accumulator.
 */

import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ── Constants ───────────────────────────────────────────────────

export const WIP_LIMIT = parseInt(process.env.KANBAN_WIP_LIMIT ?? "3", 10);

export const PRIORITY_ORDER: Record<string, number> = {
	critical: 1,
	high: 2,
	medium: 3,
	low: 4,
};

// ── Path helpers ────────────────────────────────────────────────

function findKanbanDir(): string | null {
	const env = process.env.KANBAN_DIR;
	if (env && existsSync(env)) return env;
	const cwdFallback = join(process.cwd(), "kanban");
	return existsSync(cwdFallback) ? cwdFallback : null;
}

export function kanbanDir(): string {
	const dir = findKanbanDir();
	if (!dir) throw new Error("Kanban directory not found. Set KANBAN_DIR or create a 'kanban' directory in the current working directory.");
	return dir;
}

export const boardLogPath = (): string => join(kanbanDir(), "board.log");
export const snapshotPath = (): string => join(kanbanDir(), "snapshot.md");
export const nowZ = (): string => new Date().toISOString();
// Lines appended by this process (for watcher self-detection)
export const selfAppendedLines = new Set<string>();

export const logAppend = async (line: string): Promise<void> => {
	selfAppendedLines.add(line);
	await appendFile(boardLogPath(), `${line}\n`, "utf-8");
};

/**
 * Escape a value for inclusion in a quote-wrapped log field (e.g. `text="..."`).
 * The board.log parser only understands a single pair of double quotes per
 * field — it has no escape sequence — so any embedded `"` must be replaced
 * to keep the line round-trippable through parseBoard.
 */
export const escapeLogValue = (s: string): string => s.replace(/[\r\n]/g, " ").replace(/"/g, "'");

// ── Task file helpers ────────────────────────────────────────────

const tasksDir = (): string => join(kanbanDir(), "tasks");
const taskFilePath = (taskId: string): string => join(tasksDir(), `${taskId}.md`);

/** Ensure the tasks directory exists. */
async function ensureTasksDir(): Promise<void> {
	const dir = tasksDir();
	if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

/** Format tags string as a YAML array. */
function formatTagsYaml(tags: string): string {
	if (!tags.trim()) return "[]";
	const items = tags.split(",").map((t) => t.trim()).filter(Boolean);
	return `[${items.join(", ")}]`;
}

/** Write or overwrite a task markdown file with YAML frontmatter. */
export async function writeTaskFile(
	taskId: string,
	meta: { title: string; description: string; priority: string; tags: string; agent: string },
	notes: string[] = [],
	created?: string,
): Promise<void> {
	await ensureTasksDir();
	const notesSection = notes.length > 0
		? ["\n## Notes", "", ...notes.map((n) => `- ${n}`)].join("\n")
		: "\n## Notes";
	const lines = [
		"---",
		`title: "${meta.title.replace(/"/g, "'")}"`  ,
		`priority: ${meta.priority}`,
		`tags: ${formatTagsYaml(meta.tags)}`,
		`agent: ${meta.agent}`,
		`created: ${created ?? nowZ()}`,
		"---",
		"",
	];
	if (meta.description) {
		lines.push(meta.description, "");
	}
	lines.push(notesSection, "");
	await writeFile(taskFilePath(taskId), lines.join("\n"), "utf-8");
}

/** Append a timestamped note to an existing task markdown file. Creates a stub file if missing. */
export async function appendTaskNote(taskId: string, agent: string, text: string): Promise<void> {
	await ensureTasksDir();
	const fp = taskFilePath(taskId);
	const entry = `${nowZ()} [${agent}] ${text}`;
	if (existsSync(fp)) {
		const existing = await readFile(fp, "utf-8");
		await writeFile(fp, `${existing.trimEnd()}\n- ${entry}\n`, "utf-8");
	} else {
		await writeTaskFile(taskId, { title: taskId, description: "", priority: "medium", tags: "", agent: "" }, [entry]);
	}
}

/** Read the notes from an existing task file (everything after ## Notes). */
async function readTaskNotes(taskId: string): Promise<string[]> {
	const fp = taskFilePath(taskId);
	if (!existsSync(fp)) return [];
	const content = await readFile(fp, "utf-8");
	const notesIdx = content.indexOf("## Notes");
	if (notesIdx === -1) return [];
	const afterHeading = content.slice(notesIdx + "## Notes".length);
	return afterHeading
		.split("\n")
		.filter((l) => l.startsWith("- "))
		.map((l) => l.slice(2));
}

/** Read the created timestamp from an existing task file frontmatter. */
async function readTaskCreated(taskId: string): Promise<string | undefined> {
	const fp = taskFilePath(taskId);
	if (!existsSync(fp)) return undefined;
	const content = await readFile(fp, "utf-8");
	const match = content.match(/^created:\s*(.+)$/m);
	return match?.[1]?.trim();
}

/** Rewrite a task file after an edit, preserving existing notes and created timestamp. */
export async function rewriteTaskFile(
	taskId: string,
	meta: { title: string; description: string; priority: string; tags: string; agent: string },
): Promise<void> {
	await ensureTasksDir();
	const notes = await readTaskNotes(taskId);
	const created = await readTaskCreated(taskId);
	await writeTaskFile(taskId, meta, notes, created);
}

// ── Types ───────────────────────────────────────────────────────

export interface TaskState {
	id: string;
	col: string;
	deleted: boolean;
	title: string;
	priority: string;
	tags: string;
	description: string;
	agent: string;
	claimed: boolean;
	claimAgent: string;
	model: string;
	expires: string;
	reason: string;
	notes: string[];
	completedAt: string;
	duration: string;
	doneAgent: string;
	createdAt: string;
}

export interface BoardState {
	tasks: Map<string, TaskState>;
	/** Insertion-ordered task IDs */
	order: string[];
	totalEvents: number;
}

// ── Parser ──────────────────────────────────────────────────────

function newTask(id: string, ts: string): TaskState {
	return {
		id, col: "backlog", deleted: false, priority: "medium",
		claimed: false, notes: [], createdAt: ts,
		title: "", tags: "", description: "", agent: "", claimAgent: "", model: "", expires: "",
		reason: "", completedAt: "", duration: "", doneAgent: "",
	};
}

/** Parse key=value pairs (with quoted values) from log fields. */
function parseKV(fields: string[]): Record<string, string> {
	const kv: Record<string, string> = {};
	let i = 0;
	while (i < fields.length) {
		const field = fields[i] ?? "";
		const eq = field.indexOf("=");
		if (eq <= 0) { i++; continue; }
		const key = field.slice(0, eq);
		let val = field.slice(eq + 1);
		if (val.startsWith('"')) {
			val = val.slice(1);
			while (!val.endsWith('"') && i + 1 < fields.length) {
				i++;
				val += ` ${fields[i] ?? ""}`;
			}
			if (val.endsWith('"')) val = val.slice(0, -1);
		}
		kv[key] = val;
		i++;
	}
	return kv;
}

/** Apply a single event to a task accumulator. */
function applyEvent(task: TaskState, event: string, agent: string, ts: string, kv: Record<string, string>): void {
	switch (event) {
		case "CREATE":
			if (kv.title) task.title = kv.title;
			if (kv.priority) task.priority = kv.priority;
			if (kv.tags) task.tags = kv.tags;
			if (kv.description) task.description = kv.description;
			task.createdAt = ts;
			task.agent = agent;
			break;
		case "MOVE":
			if (kv.to) task.col = kv.to;
			break;
		case "CLAIM":
			if (!task.claimed) {
				task.claimed = true;
				task.claimAgent = agent;
				task.col = "in-progress";
				if (kv.expires) task.expires = kv.expires;
				if (kv.model) task.model = kv.model;
			}
			break;
		case "UNCLAIM":
		case "EXPIRE":
			task.claimed = false;
			task.claimAgent = "";
			task.expires = "";
			break;
		case "COMPLETE":
			task.claimed = false;
			task.claimAgent = "";
			task.expires = "";
			task.completedAt = ts;
			task.col = "done";
			if (kv.duration) task.duration = kv.duration;
			task.doneAgent = agent;
			break;
		case "BLOCK":
			task.claimed = false;
			task.claimAgent = "";
			task.col = "blocked";
			if (kv.reason) task.reason = kv.reason;
			break;
		case "UNBLOCK":
			task.reason = "";
			task.col = "todo";
			break;
		case "NOTE":
			task.notes.push(`${ts} [${agent}] ${kv.text ?? ""}`);
			break;
		case "DELETE":
			task.deleted = true;
			break;
		case "EDIT":
			if (kv.title) task.title = kv.title;
			if (kv.priority) task.priority = kv.priority;
			if (kv.tags) task.tags = kv.tags;
			if (kv.description) task.description = kv.description;
			break;
	}
}

/** Parse board.log into fully materialised board state. */
export async function parseBoard(): Promise<BoardState> {
	const raw = await readFile(boardLogPath(), "utf-8");
	const lines = raw.split("\n").filter((l) => l.trim());
	const tasks = new Map<string, TaskState>();
	const order: string[] = [];

	for (const line of lines) {
		const parts = line.split(/\s+/);
		const ts = parts[0] ?? "";
		const event = parts[1] ?? "";
		const tid = parts[2] ?? "";
		const agent = parts[3] ?? "";

		if (!/^T-\d+$/.test(tid)) continue;

		if (!tasks.has(tid)) {
			tasks.set(tid, newTask(tid, ts));
			order.push(tid);
		}
		const task = tasks.get(tid) as TaskState;
		applyEvent(task, event, agent, ts, parseKV(parts.slice(4)));
	}

	return { tasks, order, totalEvents: lines.length };
}

// ── Shared helpers ──────────────────────────────────────────────

/** Throw if task_id doesn't match T-NNN format. */
export function validateTaskId(task_id: string): void {
	if (!/^T-\d+$/.test(task_id)) {
		throw new Error(`task_id must match T-NNN format (got "${task_id}")`);
	}
}

/** Parse board, look up taskId, throw if missing. */
export async function getTask(taskId: string): Promise<TaskState> {
	const board = await parseBoard();
	const task = board.tasks.get(taskId);
	if (!task) throw new Error(`Task ${taskId} not found`);
	return task;
}

// ── Mutation helpers ────────────────────────────────────────────
//
// Single source of truth for the log-line format and column-rule validation
// of DELETE and MOVE events. Both the kanban_delete/kanban_move tools and
// the TUI overlay route through these — keeping the log vocabulary, the
// quote-escape pattern, and the column invariants in one place.

/**
 * Append a DELETE event for `taskId`, validating that the task exists,
 * is not already deleted, and is in a column that permits deletion
 * (in-progress and blocked tasks must be completed/unblocked first).
 *
 * Throws on validation failure or filesystem error.
 */
export async function deleteTask(taskId: string, agent: string, reason: string = ""): Promise<{ task_id: string; previousCol: string; reason: string }> {
	validateTaskId(taskId);
	const task = await getTask(taskId);
	if (task.deleted) throw new Error(`Task ${taskId} has already been deleted`);
	if (["in-progress", "blocked"].includes(task.col)) {
		throw new Error(`Cannot delete task ${taskId}: it is currently in '${task.col}'. Complete or unblock the task before deleting it.`);
	}
	const reasonSuffix = reason ? ` reason="${escapeLogValue(reason)}"` : "";
	await logAppend(`${nowZ()} DELETE ${taskId} ${agent}${reasonSuffix}`);
	return { task_id: taskId, previousCol: task.col, reason };
}

/**
 * Append a MOVE event for `taskId`, validating that the task exists and is
 * currently in a column that may be moved (only `backlog` and `todo` —
 * in-progress, blocked, and done tasks are owned by other lifecycle events).
 *
 * Throws on validation failure or filesystem error.
 */
export async function moveTask(taskId: string, agent: string, to: "backlog" | "todo"): Promise<{ task_id: string; from: string; to: string }> {
	validateTaskId(taskId);
	const task = await getTask(taskId);
	if (["in-progress", "blocked", "done"].includes(task.col)) {
		throw new Error(`Cannot move task ${taskId} from '${task.col}' column. Can only move from backlog or todo.`);
	}
	const from = task.col;
	if (from === to) {
		throw new Error(`Task ${taskId} is already in ${to}.`);
	}
	await logAppend(`${nowZ()} MOVE ${taskId} ${agent} from=${from} to=${to}`);
	return { task_id: taskId, from, to };
}
