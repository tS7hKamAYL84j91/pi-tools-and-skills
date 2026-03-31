/**
 * Kanban Extension — Pure TypeScript
 *
 * All board operations work directly on board.log (no shell scripts required).
 * Shell scripts remain as CLI fallback but tools do not depend on them.
 *
 * Board.log format:
 *   {ISO8601Z} {EVENT} {TASK_ID} {AGENT} {key=value pairs}
 *
 * Events: CREATE, MOVE, CLAIM, COMPLETE, BLOCK, UNBLOCK, NOTE, UNCLAIM, EXPIRE, SNAPSHOT
 *
 * Tools:
 *   kanban_create   — create a new task in the backlog
 *   kanban_pick     — claim the next highest-priority todo task
 *   kanban_complete — mark a task done
 *   kanban_block    — mark a task blocked
 *   kanban_note     — append a progress note to a task
 *   kanban_snapshot — regenerate and read snapshot.md
 *   kanban_monitor  — check progress on all in-progress tasks
 *
 * Flags:
 *   --prod          — kanban_monitor sends a status nudge to stalled agents
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as net from "node:net";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

type ContentBlock = { type: "text"; text: string };
type ToolResult = { content: ContentBlock[]; details: Record<string, unknown> };

// ── Board.log location resolution ───────────────────────────────────────────

const WIP_LIMIT = parseInt(process.env.KANBAN_WIP_LIMIT ?? '3', 10);

const PRIORITY_ORDER: Record<string, number> = {
	critical: 1,
	high: 2,
	medium: 3,
	low: 4,
};

function findKanbanDir(): string | null {
	const env = process.env.KANBAN_DIR;
	if (env && existsSync(env)) return env;

	// ~/git/coas/kanban
	const home = join(homedir(), "git", "coas", "kanban");
	if (existsSync(home)) return home;

	// ./kanban relative to CWD
	const cwd = join(process.cwd(), "kanban");
	if (existsSync(cwd)) return cwd;

	return null;
}

function kanbanDir(): string {
	const dir = findKanbanDir();
	if (!dir) {
		throw new Error(
			"Kanban directory not found. Set KANBAN_DIR or ensure ~/git/coas/kanban exists.",
		);
	}
	return dir;
}

function boardLogPath(): string {
	return join(kanbanDir(), "board.log");
}

function snapshotPath(): string {
	return join(kanbanDir(), "snapshot.md");
}

function nowZ(): string {
	return new Date().toISOString();
}

async function logAppend(line: string): Promise<void> {
	await appendFile(boardLogPath(), `${line}\n`, "utf-8");
}

// ── board.log parser ────────────────────────────────────────────────────────

interface TaskState {
	id: string;
	col: string;
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

function newTask(id: string, ts: string): TaskState {
	return {
		id,
		col: "backlog",
		title: "",
		priority: "medium",
		tags: "",
		agent: "",
		claimed: false,
		claimAgent: "",
		expires: "",
		reason: "",
		notes: [],
		completedAt: "",
		duration: "",
		doneAgent: "",
		createdAt: ts,
	};
}

/** Parse key=value (with quoted values that may contain spaces) from fields */
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

interface BoardState {
	tasks: Map<string, TaskState>;
	/** Insertion-ordered task IDs */
	order: string[];
	totalEvents: number;
}

async function parseBoard(): Promise<BoardState> {
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
		const payload = parts.slice(4);

		if (!/^T-\d+$/.test(tid)) continue;

		if (!tasks.has(tid)) {
			const t = newTask(tid, ts);
			tasks.set(tid, t);
			order.push(tid);
		}
		const task = tasks.get(tid) as TaskState;
		const kv = parseKV(payload);

		switch (event) {
			case "CREATE":
				if (kv.title) task.title = kv.title;
				if (kv.priority) task.priority = kv.priority;
				if (kv.tags) task.tags = kv.tags;
				task.createdAt = ts;
				break;
			case "MOVE":
				if (kv.to) task.col = kv.to;
				break;
			case "CLAIM":
				if (!task.claimed) {
					task.claimed = true;
					task.claimAgent = agent;
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
				if (kv.reason) task.reason = kv.reason;
				break;
			case "UNBLOCK":
				task.reason = "";
				break;
			case "NOTE":
				task.notes.push(`${ts} [${agent}] ${kv.text ?? ""}`);
				break;
		}
	}

	return { tasks, order, totalEvents: lines.length };
}

// ── Snapshot generator (pure TS, replaces awk) ──────────────────────────────

function generateSnapshot(board: BoardState): string {
	const { tasks, order, totalEvents } = board;
	const now = nowZ();

	// Bucket by column, preserving log order
	const backlog: TaskState[] = [];
	const todo: TaskState[] = [];
	const inProgress: TaskState[] = [];
	const blocked: TaskState[] = [];
	const done: TaskState[] = [];

	for (const tid of order) {
		const t = tasks.get(tid);
		if (!t) continue;
		switch (t.col) {
			case "backlog": backlog.push(t); break;
			case "todo": todo.push(t); break;
			case "in-progress": inProgress.push(t); break;
			case "blocked": blocked.push(t); break;
			case "done": done.push(t); break;
		}
	}

	const wip = inProgress.length;
	const lines: string[] = [];

	lines.push("# CoAS Kanban — Snapshot");
	lines.push(`_Generated: ${now} | Log events: ${totalEvents} | WIP: ${wip}/${WIP_LIMIT}_`);
	lines.push("");

	// Backlog
	lines.push(`## 📋 Backlog (${backlog.length})`);
	if (backlog.length === 0) {
		lines.push("_empty_");
	} else {
		lines.push("| ID | Title | Priority | Tags |");
		lines.push("|----|-------|----------|------|");
		for (const t of backlog) {
			lines.push(`| ${t.id} | ${t.title} | ${t.priority} | ${t.tags} |`);
		}
	}
	// Render notes for backlog tasks
	for (const t of backlog) {
		if (t.notes.length > 0) {
			lines.push("");
			lines.push(`**Notes for ${t.id}:**`);
			for (const note of t.notes) {
				lines.push(`- ${note}`);
			}
		}
	}
	lines.push("");

	// Todo
	lines.push(`## 🔜 Todo (${todo.length})`);
	if (todo.length === 0) {
		lines.push("_empty_");
	} else {
		lines.push("| ID | Title | Priority | Tags |");
		lines.push("|----|-------|----------|------|");
		for (const t of todo) {
			lines.push(`| ${t.id} | ${t.title} | ${t.priority} | ${t.tags} |`);
		}
	}
	// Render notes for todo tasks
	for (const t of todo) {
		if (t.notes.length > 0) {
			lines.push("");
			lines.push(`**Notes for ${t.id}:**`);
			for (const note of t.notes) {
				lines.push(`- ${note}`);
			}
		}
	}
	lines.push("");

	// In Progress
	lines.push(`## 🔄 In Progress (${wip}/${WIP_LIMIT})`);
	if (inProgress.length === 0) {
		lines.push("_empty_");
	} else {
		lines.push("| ID | Title | Agent | Expires |");
		lines.push("|----|-------|-------|---------|");
		for (const t of inProgress) {
			lines.push(`| ${t.id} | ${t.title} | ${t.claimAgent} | ${t.expires} |`);
		}
	}
	// Render notes for in-progress tasks
	for (const t of inProgress) {
		if (t.notes.length > 0) {
			lines.push("");
			lines.push(`**Notes for ${t.id}:**`);
			for (const note of t.notes) {
				lines.push(`- ${note}`);
			}
		}
	}
	lines.push("");

	// Blocked
	lines.push(`## 🚫 Blocked (${blocked.length})`);
	if (blocked.length === 0) {
		lines.push("_empty_");
	} else {
		lines.push("| ID | Title | Reason |");
		lines.push("|----|-------|--------|");
		for (const t of blocked) {
			lines.push(`| ${t.id} | ${t.title} | ${t.reason} |`);
		}
	}
	// Render notes for blocked tasks
	for (const t of blocked) {
		if (t.notes.length > 0) {
			lines.push("");
			lines.push(`**Notes for ${t.id}:**`);
			for (const note of t.notes) {
				lines.push(`- ${note}`);
			}
		}
	}
	lines.push("");

	// Done (last 10)
	lines.push(`## ✅ Done (last 10 of ${done.length})`);
	if (done.length === 0) {
		lines.push("_empty_");
	} else {
		lines.push("| ID | Title | Agent | Completed | Duration |");
		lines.push("|----|-------|-------|-----------|----------|");
		const last10 = done.slice(-10);
		for (const t of last10) {
			lines.push(`| ${t.id} | ${t.title} | ${t.doneAgent || "—"} | ${t.completedAt || "—"} | ${t.duration || "—"} |`);
		}
	}
	// Render notes for done tasks (last 10)
	const last10Done = done.slice(-10);
	for (const t of last10Done) {
		if (t.notes.length > 0) {
			lines.push("");
			lines.push(`**Notes for ${t.id}:**`);
			for (const note of t.notes) {
				lines.push(`- ${note}`);
			}
		}
	}
	lines.push("");
	lines.push("---");
	lines.push("_Source: kanban/board.log | Read-only: do not edit this file_");

	return lines.join("\n");
}

// ── Monitor: stall-detection state ──────────────────────────────────────────

const MONITOR_STATE_DIR = process.env.KANBAN_MONITOR_STATE_DIR ?? "/tmp/kanban-monitor-state";
const MONITOR_STALL_DEFAULT = 3;

async function monitorStateRead(file: string, fallback: string): Promise<string> {
	try { return (await readFile(file, "utf-8")).trim(); } catch { return fallback; }
}
async function monitorStateWrite(file: string, value: string): Promise<void> {
	await mkdir(MONITOR_STATE_DIR, { recursive: true });
	await writeFile(file, value, "utf-8");
}
function md5(s: string): string {
	return createHash("md5").update(s).digest("hex");
}
async function getStallCount(tid: string): Promise<number> {
	return parseInt(await monitorStateRead(`${MONITOR_STATE_DIR}/${tid}.stall`, "0"), 10) || 0;
}
async function setStallCount(tid: string, n: number): Promise<void> {
	await monitorStateWrite(`${MONITOR_STATE_DIR}/${tid}.stall`, String(n));
}
async function getLastHash(tid: string): Promise<string> {
	return monitorStateRead(`${MONITOR_STATE_DIR}/${tid}.hash`, "");
}
async function saveHash(tid: string, hash: string): Promise<void> {
	await monitorStateWrite(`${MONITOR_STATE_DIR}/${tid}.hash`, hash);
}

// ── Extension export ──────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// ── kanban_create ───────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_create",
		label: "Kanban Create",
		description:
			"Create a new task in the kanban backlog. " +
			"The task starts in the backlog column. Use kanban_snapshot to view the board afterwards.",
		promptSnippet: "Create a new kanban task in the backlog",
		parameters: Type.Object({
			task_id: Type.String({
				description: 'Task ID in T-NNN format (e.g., T-011). Must be unique.',
			}),
			agent: Type.String({
				description: 'Agent name creating the task (lowercase, hyphens only, e.g. "lead")',
			}),
			title: Type.String({
				description: 'Human-readable task title',
			}),
			priority: Type.String({
				description: 'Task priority: critical | high | medium | low',
				enum: ["critical", "high", "medium", "low"],
			}),
			tags: Type.Optional(
				Type.String({
					description: 'Optional comma-separated tags (e.g. "tools,research")',
					default: "",
				}),
			),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const { task_id, agent, title, priority } = params;
			const tags = params.tags ?? "";

			// Validate T-NNN format
			if (!/^T-\d+$/.test(task_id)) {
				throw new Error(`task_id must match T-NNN format (got "${task_id}")`);
			}

			const ts = nowZ();
			// Validate no duplicate
			const existing = await parseBoard();
			if (existing.tasks.has(task_id)) {
				throw new Error(`Task ID ${task_id} already exists`);
			}

			await logAppend(`${ts} CREATE ${task_id} ${agent} title="${title}" priority="${priority}" tags="${tags}"`);
			await logAppend(`${ts} MOVE ${task_id} ${agent} from=created to=backlog`);

			return {
				content: [{ type: "text", text: `Created ${task_id}: ${title} (priority=${priority})` }],
				details: { task_id, title, priority, tags },
			};
		},
	});

	// ── kanban_pick ─────────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_pick",
		label: "Kanban Pick",
		description:
			"Claim the next highest-priority todo task for an agent. " +
			"Returns the claimed task ID, NO_TASK_AVAILABLE if nothing is ready, or " +
			"WIP_LIMIT_REACHED if the 3-task in-progress cap is hit. " +
			"Call kanban_snapshot afterwards to see your task details.",
		promptSnippet: "Claim the next kanban task for an agent",
		parameters: Type.Object({
			agent: Type.String({
				description: 'Agent name claiming the task (lowercase, hyphens only, e.g. "tools-worker")',
			}),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const { agent } = params;
			const board = await parseBoard();

			// Check WIP limit
			let wip = 0;
			for (const t of board.tasks.values()) {
				if (t.col === "in-progress") wip++;
			}
			if (wip >= WIP_LIMIT) {
				return {
					content: [{ type: "text", text: `WIP_LIMIT_REACHED (${wip}/${WIP_LIMIT})` }],
					details: { agent, result: "WIP_LIMIT_REACHED", claimed: false },
				};
			}

			// Find highest-priority todo or backlog task (not claimed)
			let bestId = "";
			let bestPri = 99;
			for (const tid of board.order) {
				const t = board.tasks.get(tid);
				if (!t || (t.col !== "todo" && t.col !== "backlog") || t.claimed) continue;
				const pri = PRIORITY_ORDER[t.priority] ?? 99;
				if (pri < bestPri || (pri === bestPri && parseInt(tid.slice(2), 10) < parseInt(bestId.slice(2), 10))) {
					bestPri = pri;
					bestId = tid;
				}
			}

			if (!bestId) {
				return {
					content: [{ type: "text", text: "NO_TASK_AVAILABLE" }],
					details: { agent, result: "NO_TASK_AVAILABLE", claimed: false },
				};
			}

			// Calculate expires = now + 2 hours
			const now = new Date();
			const expires = new Date(now.getTime() + 2 * 60 * 60 * 1000)
				.toISOString();
			const ts = nowZ();
			const fromCol = board.tasks.get(bestId)?.col ?? "todo";

			await logAppend(`${ts} CLAIM ${bestId} ${agent} expires=${expires}`);
			await logAppend(`${ts} MOVE ${bestId} ${agent} from=${fromCol} to=in-progress`);

			return {
				content: [
					{
						type: "text",
						text: `Claimed ${bestId} for agent "${agent}".\nRun kanban_snapshot to see full task details.`,
					},
				],
				details: { agent, result: bestId, claimed: true },
			};
		},
	});

	// ── kanban_complete ─────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_complete",
		label: "Kanban Complete",
		description:
			"Mark an in-progress task as done. " +
			"Optionally provide how long the task took (e.g. '45m', '2h').",
		promptSnippet: "Mark a kanban task as completed",
		parameters: Type.Object({
			task_id: Type.String({
				description: 'Task ID in T-NNN format',
			}),
			agent: Type.String({
				description: 'Agent name that completed the task (must match the claiming agent)',
			}),
			duration: Type.Optional(
				Type.String({
					description: 'Optional duration string (e.g. "45m", "2h", "107m")',
					default: "unknown",
				}),
			),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const { task_id, agent } = params;
			const duration = params.duration ?? "unknown";
			const ts = nowZ();

			// Validate task exists and is in-progress
			const board = await parseBoard();
			const task = board.tasks.get(task_id);
			if (!task) {
				throw new Error(`Task ${task_id} not found`);
			}
			if (task.col !== "in-progress") {
				throw new Error(`Task ${task_id} is not in-progress (col=${task.col})`);
			}

			await logAppend(`${ts} COMPLETE ${task_id} ${agent} duration=${duration}`);
			await logAppend(`${ts} MOVE ${task_id} ${agent} from=in-progress to=done`);

			// Clean up stall state
			await setStallCount(task_id, 0);
			await saveHash(task_id, '');

			return {
				content: [{ type: "text", text: `Completed ${task_id} (agent=${agent}, duration=${duration})` }],
				details: { task_id, agent, duration },
			};
		},
	});

	// ── kanban_block ────────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_block",
		label: "Kanban Block",
		description:
			"Mark an in-progress task as blocked. " +
			"Frees the WIP slot and records the reason. " +
			"The orchestrator will see this and can unblock by resolving the dependency.",
		promptSnippet: "Mark a kanban task as blocked with a reason",
		parameters: Type.Object({
			task_id: Type.String({
				description: 'Task ID in T-NNN format',
			}),
			agent: Type.String({
				description: 'Agent name that is blocked',
			}),
			reason: Type.String({
				description: 'Short description of what is needed to unblock (e.g. "waiting for API key from orchestrator")',
			}),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const { task_id, agent, reason } = params;
			const ts = nowZ();

			// Validate task exists and is in-progress
			const board = await parseBoard();
			const task = board.tasks.get(task_id);
			if (!task) {
				throw new Error(`Task ${task_id} not found`);
			}
			if (task.col !== "in-progress") {
				throw new Error(`Task ${task_id} is not in-progress (col=${task.col})`);
			}

			await logAppend(`${ts} BLOCK ${task_id} ${agent} reason="${reason}"`);
			await logAppend(`${ts} MOVE ${task_id} ${agent} from=in-progress to=blocked`);

			return {
				content: [{ type: "text", text: `Blocked ${task_id}: ${reason}` }],
				details: { task_id, agent, reason },
			};
		},
	});

	// ── kanban_note ─────────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_note",
		label: "Kanban Note",
		description:
			"Append a timestamped progress note to a task. " +
			"Use for milestones, status updates, and observations. " +
			"Notes appear in the snapshot under the task.",
		promptSnippet: "Add a progress note to a kanban task",
		parameters: Type.Object({
			task_id: Type.String({
				description: 'Task ID in T-NNN format',
			}),
			agent: Type.String({
				description: 'Agent name adding the note',
			}),
			text: Type.String({
				description: 'Note text (e.g. "core logic done, writing tests")',
			}),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const { task_id, agent, text } = params;
			const ts = nowZ();

			await logAppend(`${ts} NOTE ${task_id} ${agent} text="${text}"`);

			return {
				content: [{ type: "text", text: `Note added to ${task_id}` }],
				details: { task_id, agent, text },
			};
		},
	});

	// ── kanban_snapshot ─────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_snapshot",
		label: "Kanban Snapshot",
		description:
			"Regenerate snapshot.md from board.log and return the full board view. " +
			"Shows all columns: Backlog, Todo, In Progress, Blocked, and Done (last 10). " +
			"Always run this before presenting board status to a human.",
		promptSnippet: "Regenerate and read the kanban board snapshot",
		parameters: Type.Object({}),

		async execute(_toolCallId, _params, _signal): Promise<ToolResult> {
			const board = await parseBoard();
			const snapshot = generateSnapshot(board);
			const sp = snapshotPath();

			await writeFile(sp, snapshot, "utf-8");

			// Append SNAPSHOT marker
			await logAppend(`${nowZ()} SNAPSHOT T-000 orchestrator seq=${board.totalEvents}`);

			return {
				content: [
					{
						type: "text",
						text: `Snapshot written to ${sp}\nTotal events in log: ${board.totalEvents}\n\n---\n\n${snapshot}`,
					},
				],
				details: { snapshotPath: sp, totalEvents: board.totalEvents },
			};
		},
	});

	// ── kanban_monitor ──────────────────────────────────────────────
	pi.registerFlag("prod", {
		description: "kanban_monitor: send a status nudge to stalled agents via agent_send",
		type: "boolean",
		default: false,
	});

	pi.registerTool({
		name: "kanban_monitor",
		label: "Kanban Monitor",
		description:
			"Check progress on all in-progress kanban tasks. " +
			"Parses board.log directly, then inspects each agent via the panopticon registry. " +
			"Detects ACTIVE, STALLED (no pane change for N cycles), BLOCKED, DONE (REPORT.md), " +
			"and MISSING states. With prod=true (or --prod flag) sends a status nudge to stalled agents.",
		promptSnippet: "Check progress on all in-progress kanban tasks",
		promptGuidelines: [
			"Run kanban_monitor periodically to surface stalled or blocked agents.",
			"Use prod=true only after an agent has been STALLED for multiple cycles — trust but verify.",
			"When kanban_monitor reports DONE (REPORT.md found), call kanban_complete to close the task.",
		],
		parameters: Type.Object({
			prod: Type.Optional(Type.Boolean({
				description: "Send a nudge message to stalled agents (default: false, or set via --prod flag)",
				default: false,
			})),
			stall_cycles: Type.Optional(Type.Number({
				description: "Consecutive unchanged activity snapshots before declaring STALLED (default: 3)",
				default: 3,
			})),
			verbose: Type.Optional(Type.Boolean({
				description: "Include raw last-line of activity output for ACTIVE tasks (default: false)",
				default: false,
			})),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const isProd = params.prod ?? (pi.getFlag("--prod") as boolean | undefined) ?? false;
			const stallThreshold = params.stall_cycles ?? MONITOR_STALL_DEFAULT;
			const verbose = params.verbose ?? false;

			// ── 1. Parse board directly (no shell script) ────────────
			const board = await parseBoard();
			const kDir = kanbanDir();
			const monitorLog = join(kDir, "monitor.log");
			const commFile = resolve(kDir, "..", "COMMUNICATION.md");
			const ts = new Date().toISOString();

			// ── 2. Get in-progress tasks from parsed board ───────────
			type TaskRow = { id: string; agent: string; title: string };
			const tasks: TaskRow[] = [];
			for (const tid of board.order) {
				const t = board.tasks.get(tid);
				if (t && t.col === "in-progress") {
					tasks.push({ id: t.id, agent: t.claimAgent || t.agent, title: t.title });
				}
			}

			// ── 3. Check each task ───────────────────────────────────
			type Status = "ACTIVE" | "STALLED" | "BLOCKED" | "DONE" | "MISSING";
			type TaskResult = { id: string; agent: string; status: Status; detail: string };
			const results: TaskResult[] = [];
			const counts = { active: 0, stalled: 0, blocked: 0, done: 0, missing: 0 };

			for (const task of tasks) {
				let status: Status = "ACTIVE";
				let detail = "";

				// 3a. DONE? — REPORT.md in common research paths
				const researchBase = process.env.KANBAN_REPORT_BASE ?? join(homedir(), "git", "working-notes", "research");
				const exactReport = join(researchBase, task.agent, "REPORT.md");
				let hasDone = existsSync(exactReport);
				if (!hasDone) {
					try {
						const { stdout: found } = await execAsync(
							`find ${JSON.stringify(researchBase)} -maxdepth 2 -name REPORT.md -path "*${task.agent}*" 2>/dev/null | head -1`,
						);
						hasDone = found.trim().length > 0;
					} catch { /* ignore */ }
				}
				if (hasDone) {
					status = "DONE"; detail = "REPORT.md found";
					counts.done++;
					await setStallCount(task.id, 0);
					results.push({ ...task, status, detail });
					continue;
				}

				// 3b. Find agent in panopticon registry
				const AGENTS_DIR = join(homedir(), ".pi", "agents");
				let agentRecord: { id: string; socket?: string } | null = null;
				try {
					if (existsSync(AGENTS_DIR)) {
						for (const f of readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".json"))) {
							try {
								const rec = JSON.parse(readFileSync(join(AGENTS_DIR, f), "utf-8"));
								if (rec.name?.toLowerCase() === task.agent.toLowerCase()) {
									agentRecord = rec;
									break;
								}
							} catch { /* skip corrupt */ }
						}
					}
				} catch { /* ignore */ }

				if (!agentRecord) {
					status = "MISSING"; detail = `no registered agent found for '${task.agent}'`;
					counts.missing++;
					results.push({ ...task, status, detail });
					continue;
				}

				// 3c. Read agent's Maildir activity log
				let activityContent = "";
				try {
					const maildirPath = join(AGENTS_DIR, agentRecord.id);
					if (existsSync(maildirPath)) {
						const files = readdirSync(maildirPath).filter((f) => f.endsWith(".json")).sort();
						const recent = files.slice(-15);
						const entries = recent.map((f) => {
							try { return readFileSync(join(maildirPath, f), "utf-8"); } catch { return ""; }
						}).filter(Boolean);
						activityContent = entries.join("\n");
					}
				} catch { /* maildir read failed */ }

				const lastLine = activityContent.split("\n").filter((l) => l.trim()).at(-1)?.trim().slice(0, 80) ?? "";

				// 3d. BLOCKED?
				if (activityContent.includes("BLOCKED:") || activityContent.includes('"blocked"')) {
					const bLine = activityContent.split("\n").find((l) => l.includes("BLOCKED:") || l.includes('"blocked"'))
						?.replace(/.*BLOCKED:/, "BLOCKED:").slice(0, 80) ?? "BLOCKED: (see activity log)";
					status = "BLOCKED"; detail = bLine;
					counts.blocked++;
					await setStallCount(task.id, 0);
					results.push({ ...task, status, detail });
					continue;
				}

				// 3e. Stall detection
				const curHash = md5(activityContent);
				const lastHash = await getLastHash(task.id);
				let stallCount = await getStallCount(task.id);

				if (curHash === lastHash && lastHash !== "") {
					stallCount++;
					await setStallCount(task.id, stallCount);
					if (stallCount >= stallThreshold) {
						status = "STALLED";
						detail = `no activity change for ${stallCount} cycle(s)`;
						counts.stalled++;
						if (isProd) {
							const nudge = `Status update? ${task.id} appears stalled. Please share progress or call kanban_block if stuck.`;
							const sockPath = agentRecord.socket ?? join(AGENTS_DIR, `${agentRecord.id}.sock`);
							try {
								if (existsSync(sockPath)) {
									
									await new Promise<void>((res, rej) => {
										const client = net.createConnection({ path: sockPath }, () => {
											client.end(JSON.stringify({ type: "cast", from: "kanban-monitor", text: nudge }) + "\n");
										});
										client.on("end", () => res());
										client.on("error", (e: Error) => rej(e));
										client.setTimeout(3000);
										client.on("timeout", () => { client.destroy(); rej(new Error("timeout")); });
									});
									detail += " — nudge sent";
								} else {
									detail += " — no socket, nudge skipped";
								}
							} catch {
								detail += " — nudge failed";
							}
						}
					} else {
						status = "ACTIVE";
						detail = `unchanged ${stallCount}/${stallThreshold} cycles`;
						if (verbose) detail += ` — ${lastLine}`;
						counts.active++;
					}
				} else {
					await saveHash(task.id, curHash);
					await setStallCount(task.id, 0);
					status = "ACTIVE";
					detail = verbose ? lastLine || "(running)" : "(running)";
					counts.active++;
				}

				results.push({ ...task, status, detail });
			}

			// ── 4. Format report ────────────────────────────────────
			const reportLines: string[] = [`=== Progress Check [${ts}] ===`];
			if (results.length === 0) {
				reportLines.push("  (no in-progress tasks)");
			} else {
				for (const r of results) {
					reportLines.push(`  ${r.id} (${r.agent}): ${r.status} — ${r.detail}`);
				}
			}
			reportLines.push("---");
			reportLines.push(
				`  Running: ${counts.active} | Stalled: ${counts.stalled} | ` +
				`Blocked: ${counts.blocked} | Done: ${counts.done} | Missing: ${counts.missing}`,
			);
			const report = reportLines.join("\n");

			// ── 5. Append to monitor.log ─────────────────────────────
			try {
				const logLines = [`${ts} CHECK start`];
				for (const r of results) {
					logLines.push(`${ts} ${r.id} agent=${r.agent} status=${r.status} detail=${r.detail.replace(/\n/g, " ")}`);
				}
				logLines.push(
					`${ts} SUMMARY active=${counts.active} stalled=${counts.stalled} ` +
					`blocked=${counts.blocked} done=${counts.done} missing=${counts.missing}`,
				);
				await appendFile(monitorLog, `${logLines.join("\n")}\n`, "utf-8");
			} catch { /* log failures are non-fatal */ }

			// ── 6. Alert COMMUNICATION.md if issues detected ─────────
			if (counts.stalled > 0 || counts.blocked > 0) {
				try {
					const issues = results.filter((r) => r.status === "STALLED" || r.status === "BLOCKED");
					const alertLines = [
						`[TO: lead] [FROM: kanban-monitor] ${ts} — ${counts.blocked} blocked, ${counts.stalled} stalled`,
						...issues.map((r) => `  ${r.id} (${r.agent}): ${r.status} — ${r.detail}`),
						"",
					];
					await appendFile(commFile, alertLines.join("\n"), "utf-8");
				} catch { /* non-fatal */ }
			}

			return {
				content: [{ type: "text", text: report }],
				details: {
					timestamp: ts,
					counts,
					tasks: results,
					prod: isProd,
					stallThreshold,
				},
			};
		},
	});

	// ── kanban_unblock ─────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_unblock",
		label: "Kanban Unblock",
		description:
			"Unblock a blocked task and move it to todo. " +
			"Task must be in the blocked column. " +
			"Records the resolution reason in the log.",
		promptSnippet: "Unblock a kanban task and move to todo",
		parameters: Type.Object({
			task_id: Type.String({
				description: 'Task ID in T-NNN format',
			}),
			agent: Type.String({
				description: 'Agent name unblocking the task',
			}),
			reason: Type.Optional(
				Type.String({
					description: 'Resolution reason (e.g. "API key received")',
					default: "",
				}),
			),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const { task_id, agent } = params;
			const reason = params.reason ?? "";
			const ts = nowZ();

			// Parse board to verify task is in blocked column
			const board = await parseBoard();
			const task = board.tasks.get(task_id);

			if (!task) {
				throw new Error(`Task ${task_id} not found`);
			}

			if (task.col !== "blocked") {
				throw new Error(
					`Task ${task_id} is in '${task.col}' column, not 'blocked'. Cannot unblock.`,
				);
			}

			// Log UNBLOCK and MOVE events
			await logAppend(`${ts} UNBLOCK ${task_id} ${agent} resolution="${reason}"`);
			await logAppend(`${ts} MOVE ${task_id} ${agent} from=blocked to=todo`);

			return {
				content: [
					{
						type: "text",
						text: `Unblocked ${task_id}, moved to todo`,
					},
				],
				details: { task_id, agent, reason },
			};
		},
	});

	// ── kanban_move ────────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_move",
		label: "Kanban Move",
		description:
			"Move a task between backlog and todo columns. " +
			"Task must not be in in-progress, blocked, or done columns.",
		promptSnippet: "Move a kanban task between backlog and todo",
		parameters: Type.Object({
			task_id: Type.String({
				description: 'Task ID in T-NNN format',
			}),
			agent: Type.String({
				description: 'Agent name moving the task',
			}),
			to: Type.String({
				description: 'Target column: backlog | todo',
				enum: ["backlog", "todo"],
			}),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const { task_id, agent, to } = params;
			const ts = nowZ();

			// Parse board to verify task is in an allowed column
			const board = await parseBoard();
			const task = board.tasks.get(task_id);

			if (!task) {
				throw new Error(`Task ${task_id} not found`);
			}

			const forbiddenCols = ["in-progress", "blocked", "done"];
			if (forbiddenCols.includes(task.col)) {
				throw new Error(
					`Cannot move task ${task_id} from '${task.col}' column. " +
					"Can only move from backlog or todo.`,
				);
			}

			const from = task.col;

			// Log MOVE event
			await logAppend(`${ts} MOVE ${task_id} ${agent} from=${from} to=${to}`);

			return {
				content: [
					{
						type: "text",
						text: `Moved ${task_id} from ${from} to ${to}`,
					},
				],
				details: { task_id, agent, from, to },
			};
		},
	});
}
