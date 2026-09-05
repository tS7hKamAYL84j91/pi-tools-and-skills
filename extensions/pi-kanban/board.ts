/**
 * Kanban board state — parser, types, and path helpers.
 *
 * Reads board.log and produces a BoardState with all tasks
 * bucketed by column. Pure event-sourcing: each log line is
 * an event that mutates a TaskState accumulator.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { applyEvent, parseKV } from "./board-event-handlers.js";

// ── Constants ───────────────────────────────────────────────────

export const WIP_LIMIT = parseInt(process.env.KANBAN_WIP_LIMIT ?? "3", 10);

export const PRIORITY_ORDER: Record<string, number> = {
	critical: 1,
	high: 2,
	medium: 3,
	low: 4,
};

/** Returns the display/claim rank, with legacy and unknown values last. */
function priorityRank(priority: string): number {
	return PRIORITY_ORDER[priority.trim().toLowerCase()] ?? (PRIORITY_ORDER.low ?? 4) + 1;
}

/** Sorts active-column tasks by priority while retaining canonical board order on ties. */
export function sortTasksByPriority(tasks: TaskState[]): TaskState[] {
	return tasks
		.map((task, index) => ({ task, index }))
		.sort((left, right) =>
			priorityRank(left.task.priority) - priorityRank(right.task.priority) ||
			left.index - right.index,
		)
		.map(({ task }) => task);
}

// ── Path helpers ────────────────────────────────────────────────

function findKanbanDir(): string | null {
	const env = process.env.KANBAN_DIR;
	if (env && existsSync(env)) return env;
	const cwdFallback = join(process.cwd(), "pi-kanban");
	return existsSync(cwdFallback) ? cwdFallback : null;
}

function kanbanDir(): string {
	const dir = findKanbanDir();
	if (!dir)
		throw new Error(
			"Kanban directory not found. Set KANBAN_DIR or create a 'pi-kanban' directory in the current working directory.",
		);
	return dir;
}

export const boardLogPath = (): string => join(kanbanDir(), "board.log");
export const snapshotPath = (): string => join(kanbanDir(), "snapshot.md");
export const nowZ = (): string => new Date().toISOString();

/**
 * Escape a value for inclusion in a quote-wrapped log field (e.g. `text="..."`).
 * The board.log parser only understands a single pair of double quotes per
 * field — it has no escape sequence — so any embedded `"` must be replaced
 * to keep the line round-trippable through parseBoard.
 */
export const escapeLogValue = (s: string): string =>
	s.replace(/[\r\n]/g, " ").replace(/"/g, "'");

/**
 * Sanitise an agent name for safe inclusion in log lines.
 * Strips anything that isn't lowercase alphanumeric or hyphen.
 */
export const sanitiseAgent = (s: string): string =>
	s.replace(/[^a-z0-9-]/g, "").slice(0, 64) || "unknown";

// ── Task file helpers ────────────────────────────────────────────

const tasksDir = (): string => join(kanbanDir(), "tasks");
const taskFilePath = (taskId: string): string =>
	join(tasksDir(), `${taskId}.md`);

/** Ensure the tasks directory exists. */
async function ensureTasksDir(): Promise<void> {
	const dir = tasksDir();
	if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

/** Format tags string as a YAML array. */
function formatTagsYaml(tags: string): string {
	if (!tags.trim()) return "[]";
	const items = tags
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	return `[${items.join(", ")}]`;
}

/** Write or overwrite a task markdown file with YAML frontmatter. */
export async function writeTaskFile(
	taskId: string,
	meta: {
		title: string;
		description: string;
		priority: string;
		tags: string;
		agent: string;
		verificationRequired?: boolean;
	},
	notes: string[] = [],
	created?: string,
): Promise<void> {
	await ensureTasksDir();
	const notesSection =
		notes.length > 0
			? ["\n## Notes", "", ...notes.map((n) => `- ${n}`)].join("\n")
			: "\n## Notes";
	const lines = [
		"---",
		`title: "${meta.title.replace(/"/g, "'")}"`,
		`priority: ${meta.priority}`,
		`tags: ${formatTagsYaml(meta.tags)}`,
		`agent: ${meta.agent}`,
		`created: ${created ?? nowZ()}`,
	];
	if (meta.verificationRequired) {
		lines.push("verification_required: true");
	}
	lines.push("---", "");
	if (meta.description) {
		lines.push(meta.description, "");
	}
	lines.push(notesSection, "");
	await writeFileAtomic(taskFilePath(taskId), lines.join("\n"));
}

/** Append a timestamped note to an existing task markdown file. Creates a stub file if missing. */
export async function appendTaskNote(
	taskId: string,
	agent: string,
	text: string,
): Promise<void> {
	await ensureTasksDir();
	const fp = taskFilePath(taskId);
	const entry = `${nowZ()} [${agent}] ${text}`;
	if (existsSync(fp)) {
		const existing = await readFile(fp, "utf-8");
		await writeFileAtomic(fp, `${existing.trimEnd()}\n- ${entry}\n`);
	} else {
		await writeTaskFile(
			taskId,
			{
				title: taskId,
				description: "",
				priority: "medium",
				tags: "",
				agent: "",
			},
			[entry],
		);
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
	meta: {
		title: string;
		description: string;
		priority: string;
		tags: string;
		agent: string;
	},
): Promise<void> {
	await ensureTasksDir();
	const notes = await readTaskNotes(taskId);
	const created = await readTaskCreated(taskId);
	await writeTaskFile(taskId, meta, notes, created);
}

// ── Types ───────────────────────────────────────────────────────

type TaskState = import("./board-event-handlers.js").TaskState;
export type { TaskVerificationCheck } from "./board-event-handlers.js";
export type { TaskState } from "./board-event-handlers.js";

export interface BoardState {
	tasks: Map<string, TaskState>;
	/** Insertion-ordered task IDs */
	order: string[];
	totalEvents: number;
}

// ── Parser ──────────────────────────────────────────────────────

function newTask(id: string, ts: string): TaskState {
	return {
		id,
		col: "backlog",
		deleted: false,
		priority: "medium",
		claimed: false,
		notes: [],
		createdAt: ts,
		title: "",
		tags: "",
		description: "",
		agent: "",
		claimAgent: "",
		model: "",
		expires: "",
		reason: "",
		completedAt: "",
		duration: "",
		doneAgent: "",
		verificationRequired: false,
		checks: [],
	};
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
		applyEvent({ task, event, agent, timestamp: ts, payload: parseKV(parts.slice(4)) });
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
