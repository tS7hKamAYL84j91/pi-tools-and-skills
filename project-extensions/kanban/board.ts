/**
 * Kanban board state — parser, types, and path helpers.
 *
 * Reads board.log and produces a BoardState with all tasks
 * bucketed by column. Pure event-sourcing: each log line is
 * an event that mutates a TaskState accumulator.
 */

import { existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
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
	const fallbacks = [
		join(homedir(), "git", "coas", "kanban"),
		join(process.cwd(), "kanban"),
	];
	return fallbacks.find(existsSync) ?? null;
}

export function kanbanDir(): string {
	const dir = findKanbanDir();
	if (!dir) throw new Error("Kanban directory not found. Set KANBAN_DIR or ensure ~/git/coas/kanban exists.");
	return dir;
}

export const boardLogPath = (): string => join(kanbanDir(), "board.log");
export const snapshotPath = (): string => join(kanbanDir(), "snapshot.md");
export const nowZ = (): string => new Date().toISOString();
export const logAppend = (line: string): Promise<void> => appendFile(boardLogPath(), `${line}\n`, "utf-8");

// ── Types ───────────────────────────────────────────────────────

export interface TaskState {
	id: string;
	col: string;
	deleted: boolean;
	title: string;
	priority: string;
	tags: string;
	agent: string;
	claimed: boolean;
	claimAgent: string;
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
		title: "", tags: "", agent: "", claimAgent: "", expires: "",
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
