/**
 * Kanban Extension — Pure TypeScript
 *
 * All board operations work directly on board.log (no shell scripts required).
 * Shell scripts remain as CLI fallback but tools do not depend on them.
 *
 * Board.log format:
 *   {ISO8601Z} {EVENT} {TASK_ID} {AGENT} {key=value pairs}
 *
 * Events: CREATE, MOVE, CLAIM, COMPLETE, BLOCK, UNBLOCK, NOTE, UNCLAIM, EXPIRE, SNAPSHOT, DELETE, EDIT, COMPACT
 *
 * Tools:
 *   kanban_create   — create a new task in the backlog
 *   kanban_pick     — claim the next highest-priority todo task
 *   kanban_complete — mark a task done
 *   kanban_block    — mark a task blocked
 *   kanban_note     — append a progress note to a task
 *   kanban_snapshot  — regenerate and read snapshot.md
 *   kanban_monitor   — check progress on all in-progress tasks
 *   kanban_compact   — compact board.log to minimal reconstruction events
 *   kanban_edit      — update title, priority, or tags on a backlog/todo task
 *   kanban_reassign  — transfer an in-progress task to a different agent
 *
 * Flags:
 *   --prod          — kanban_monitor sends a status nudge to stalled agents
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { exec } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
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
	const fallbacks = [join(homedir(), "git", "coas", "kanban"), join(process.cwd(), "kanban")];
	return fallbacks.find(existsSync) ?? null;
}

function kanbanDir(): string {
	const dir = findKanbanDir();
	if (!dir) throw new Error("Kanban directory not found. Set KANBAN_DIR or ensure ~/git/coas/kanban exists.");
	return dir;
}

const boardLogPath = () => join(kanbanDir(), "board.log");
const snapshotPath = () => join(kanbanDir(), "snapshot.md");
const nowZ = () => new Date().toISOString();
const logAppend = (line: string) => appendFile(boardLogPath(), `${line}\n`, "utf-8");

// ── board.log parser ────────────────────────────────────────────────────────

interface TaskState {
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

function newTask(id: string, ts: string): TaskState {
	return {
		id, col: "backlog", deleted: false, priority: "medium", claimed: false, notes: [], createdAt: ts,
		title: "", tags: "", agent: "", claimAgent: "", expires: "",
		reason: "", completedAt: "", duration: "", doneAgent: "",
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

	return { tasks, order, totalEvents: lines.length };
}

// ── Snapshot rendering helpers (pure) ─────────────────────────────────────

interface ColumnDef {
	heading: string;
	headers: string[];
	separators: string[];
	row: (t: TaskState) => string;
}

const PRIO_COL_ROW = (t: TaskState) => `| ${t.id} | ${t.title} | ${t.priority} | ${t.tags} |`;
const PRIO_COL_HDR: ColumnDef = { heading: "", headers: ["| ID | Title | Priority | Tags |"], separators: ["|----|-------|----------|------|"], row: PRIO_COL_ROW };

const COLUMN_DEFS: Record<string, ColumnDef> = {
	backlog:       { ...PRIO_COL_HDR, heading: "📋 Backlog" },
	todo:          { ...PRIO_COL_HDR, heading: "🔜 Todo" },
	"in-progress": {
		heading: "🔄 In Progress",
		headers: ["| ID | Title | Agent | Expires |"],
		separators: ["|----|-------|-------|---------|"],
		row: (t) => `| ${t.id} | ${t.title} | ${t.claimAgent} | ${t.expires} |`,
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

/** Render a column section: heading, table, and notes. Pure function. */
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

	for (const t of tasks.filter((t) => t.notes.length > 0)) {
		lines.push("", `**Notes for ${t.id}:**`, ...t.notes.map((n) => `- ${n}`));
	}
	lines.push("");
	return lines;
}

function generateSnapshot(board: BoardState): string {
	const { tasks, order, totalEvents } = board;
	const now = nowZ();

	// Bucket by column, preserving log order
	const buckets: Record<string, TaskState[]> = {
		backlog: [], todo: [], "in-progress": [], blocked: [], done: [],
	};
	for (const tid of order) {
		const t = tasks.get(tid);
		if (!t || t.deleted) continue;
		buckets[t.col]?.push(t);
	}

	const wip = buckets["in-progress"]?.length ?? 0;
	const doneAll = buckets.done ?? [];
	const doneLast10 = doneAll.slice(-10);

	const lines: string[] = [
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
	];

	return lines.join("\n");
}

// ── Monitor: types ──────────────────────────────────────────────────────

type MonitorStatus = "ACTIVE" | "STALLED" | "BLOCKED" | "DONE" | "MISSING";
interface TaskRow { id: string; agent: string; title: string }
interface TaskResult { id: string; agent: string; status: MonitorStatus; detail: string }
interface MonitorCounts { active: number; stalled: number; blocked: number; done: number; missing: number }

// ── Monitor: extracted helpers ──────────────────────────────────────────

/** Extract in-progress tasks from a parsed board. */
function getInProgressTasks(board: BoardState): TaskRow[] {
	const tasks: TaskRow[] = [];
	for (const tid of board.order) {
		const t = board.tasks.get(tid);
		if (t && t.col === "in-progress") {
			tasks.push({ id: t.id, agent: t.claimAgent || t.agent, title: t.title });
		}
	}
	return tasks;
}

/** Check if REPORT.md exists for a given agent. */
async function checkReportDone(agentName: string): Promise<boolean> {
	const researchBase = process.env.KANBAN_REPORT_BASE ?? join(homedir(), "git", "working-notes", "research");
	const exactReport = join(researchBase, agentName, "REPORT.md");
	if (existsSync(exactReport)) return true;
	try {
		const { stdout } = await execAsync(
			`find ${JSON.stringify(researchBase)} -maxdepth 2 -name REPORT.md -path "*${agentName}*" 2>/dev/null | head -1`,
		);
		return stdout.trim().length > 0;
	} catch { return false; }
}

/** Simplified agent inspection: read registry JSON, check PID liveness and heartbeat age. */
interface AgentInspection { status: MonitorStatus; detail: string; agentId?: string }

function inspectAgent(agentName: string): AgentInspection {
	const agentsDir = join(homedir(), ".pi", "agents");
	try {
		if (!existsSync(agentsDir)) return { status: "MISSING", detail: "agents dir not found" };
		for (const f of readdirSync(agentsDir).filter((f) => f.endsWith(".json"))) {
			try {
				const rec = JSON.parse(readFileSync(join(agentsDir, f), "utf-8"));
				if (rec.name?.toLowerCase() !== agentName.toLowerCase()) continue;
				const agentId = rec.id as string | undefined;
				let pidAlive = false;
				if (rec.pid) { try { process.kill(rec.pid, 0); pidAlive = true; } catch { /* not running */ } }
				if (!pidAlive) return { status: "MISSING", detail: `agent PID ${rec.pid ?? "?"} not running`, agentId };
				if (rec.heartbeat) {
					const ageMs = Date.now() - new Date(rec.heartbeat).getTime();
					if (ageMs > 300_000) return { status: "STALLED", detail: `heartbeat ${Math.round(ageMs / 60_000)}m ago`, agentId };
				}
				return { status: "ACTIVE", detail: "(running)", agentId };
			} catch { /* skip corrupt */ }
		}
	} catch { /* ignore */ }
	return { status: "MISSING", detail: `no registered agent for '${agentName}'` };
}

/** Deliver a nudge to an agent's Maildir (delegates to panopticon's durable queue). */
async function deliverNudge(agentId: string, nudge: string): Promise<"sent" | "failed"> {
	try {
		const msgFile = join(homedir(), ".pi", "agents", agentId, `${Date.now()}-kanban.json`);
		await writeFile(msgFile, JSON.stringify({ type: "cast", from: "kanban-monitor", text: nudge }), "utf-8");
		return "sent";
	} catch { return "failed"; }
}

/** Format a monitor report from results and counts. Pure. */
function formatMonitorReport(ts: string, results: TaskResult[], counts: MonitorCounts): string {
	const lines: string[] = [`=== Progress Check [${ts}] ===`];
	if (results.length === 0) {
		lines.push("  (no in-progress tasks)");
	} else {
		for (const r of results) {
			lines.push(`  ${r.id} (${r.agent}): ${r.status} — ${r.detail}`);
		}
	}
	lines.push("---");
	lines.push(
		`  Running: ${counts.active} | Stalled: ${counts.stalled} | ` +
		`Blocked: ${counts.blocked} | Done: ${counts.done} | Missing: ${counts.missing}`,
	);
	return lines.join("\n");
}

// ── Shared helpers ────────────────────────────────────────────────────────

/** Throw if task_id doesn't match T-NNN format. */
function validateTaskId(task_id: string): void {
	if (!/^T-\d+$/.test(task_id)) {
		throw new Error(`task_id must match T-NNN format (got "${task_id}")`);
	}
}

/** Parse board, look up taskId, throw if missing. */
async function getTask(taskId: string): Promise<TaskState> {
	const board = await parseBoard();
	const task = board.tasks.get(taskId);
	if (!task) throw new Error(`Task ${taskId} not found`);
	return task;
}

/** Wrap text + details into the standard ToolResult shape. */
function result(text: string, details: Record<string, unknown>): ToolResult {
	return { content: [{ type: "text", text }], details };
}

/** Reusable schema for the task_id parameter (T-NNN format). */
const TASK_ID_SCHEMA = Type.String({ description: 'Task ID in T-NNN format' });

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

			validateTaskId(task_id);

			const ts = nowZ();
			const existing = await parseBoard();
			if (existing.tasks.has(task_id)) {
				throw new Error(`Task ID ${task_id} already exists`);
			}

			await logAppend(`${ts} CREATE ${task_id} ${agent} title="${title}" priority="${priority}" tags="${tags}"`);

			return result(`Created ${task_id}: ${title} (priority=${priority})`, { task_id, title, priority, tags });
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
			const wip = [...board.tasks.values()].filter((t) => t.col === "in-progress").length;
			if (wip >= WIP_LIMIT) {
				return result(`WIP_LIMIT_REACHED (${wip}/${WIP_LIMIT})`, { agent, result: "WIP_LIMIT_REACHED", claimed: false });
			}

			// Find highest-priority todo or backlog task (not claimed)
			let bestId = "";
			let bestPri = 99;
			for (const tid of board.order) {
				const t = board.tasks.get(tid);
				if (!t || t.col !== "todo" || t.claimed) continue;
				const pri = PRIORITY_ORDER[t.priority] ?? 99;
				if (pri < bestPri || (pri === bestPri && parseInt(tid.slice(2), 10) < parseInt(bestId.slice(2), 10))) {
					bestPri = pri;
					bestId = tid;
				}
			}

			if (!bestId) {
				return result("NO_TASK_AVAILABLE", { agent, result: "NO_TASK_AVAILABLE", claimed: false });
			}

			const ts = nowZ();
			const expires = new Date(Date.now() + 7_200_000).toISOString();
			const fromCol = board.tasks.get(bestId)?.col ?? "todo";

			await logAppend(`${ts} CLAIM ${bestId} ${agent} expires=${expires}`);
			await logAppend(`${ts} MOVE ${bestId} ${agent} from=${fromCol} to=in-progress`);

			// Verify we won the claim (race condition mitigation)
			const verifyBoard = await parseBoard();
			const verifiedTask = verifyBoard.tasks.get(bestId);
			if (verifiedTask && verifiedTask.claimAgent !== agent) {
				// Another agent claimed first — unclaim and return conflict
				await logAppend(`${ts} UNCLAIM ${bestId} ${agent}`);
				return result(
					`CLAIM_CONFLICT: ${bestId} was claimed by ${verifiedTask.claimAgent}. Call kanban_pick again to try the next task.`,
					{ agent, result: "CLAIM_CONFLICT", claimed: false, conflictWith: verifiedTask.claimAgent },
				);
			}

			return result(
				`Claimed ${bestId} for agent "${agent}".\nRun kanban_snapshot to see full task details.`,
				{ agent, result: bestId, claimed: true },
			);
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
			task_id: TASK_ID_SCHEMA,
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

			const task = await getTask(task_id);
			if (task.col !== "in-progress") {
				throw new Error(`Task ${task_id} is not in-progress (col=${task.col})`);
			}

			const ts = nowZ();
			await logAppend(`${ts} COMPLETE ${task_id} ${agent} duration=${duration}`);
			await logAppend(`${ts} MOVE ${task_id} ${agent} from=in-progress to=done`);
			return result(`Completed ${task_id} (agent=${agent}, duration=${duration})`, { task_id, agent, duration });
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
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({
				description: 'Agent name that is blocked',
			}),
			reason: Type.String({
				description: 'Short description of what is needed to unblock (e.g. "waiting for API key from orchestrator")',
			}),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const { task_id, agent, reason } = params;

			const task = await getTask(task_id);
			if (task.col !== "in-progress") {
				throw new Error(`Task ${task_id} is not in-progress (col=${task.col})`);
			}

			const ts = nowZ();
			await logAppend(`${ts} BLOCK ${task_id} ${agent} reason="${reason}"`);
			await logAppend(`${ts} MOVE ${task_id} ${agent} from=in-progress to=blocked`);

			return result(`Blocked ${task_id}: ${reason}`, { task_id, agent, reason });
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
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({
				description: 'Agent name adding the note',
			}),
			text: Type.String({
				description: 'Note text (e.g. "core logic done, writing tests")',
			}),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const { task_id, agent, text } = params;
			await logAppend(`${nowZ()} NOTE ${task_id} ${agent} text="${text}"`);
			return result(`Note added to ${task_id}`, { task_id, agent, text });
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
			await logAppend(`${nowZ()} SNAPSHOT T-SYS orchestrator seq=${board.totalEvents}`);

			return result(
				`Snapshot written to ${sp}\nTotal events in log: ${board.totalEvents}\n\n---\n\n${snapshot}`,
				{ snapshotPath: sp, totalEvents: board.totalEvents },
			);
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
			"Parses board.log directly, then inspects each agent via registry PID check and heartbeat age. " +
			"Detects ACTIVE, STALLED (stale heartbeat), DONE (REPORT.md found), and MISSING states. " +
			"With prod=true (or --prod flag) delivers a nudge to stalled agents via panopticon Maildir.",
		promptSnippet: "Check progress on all in-progress kanban tasks",
		promptGuidelines: [
			"Run kanban_monitor periodically to surface stalled or blocked agents.",
			"Use prod=true when an agent is STALLED — sends a nudge via panopticon Maildir.",
			"When kanban_monitor reports DONE (REPORT.md found), call kanban_complete to close the task.",
		],
		parameters: Type.Object({
			prod: Type.Optional(Type.Boolean({
				description: "Deliver a nudge to stalled agents via panopticon Maildir (default: false, or set via --prod flag)",
				default: false,
			})),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const isProd = params.prod ?? (pi.getFlag("--prod") as boolean | undefined) ?? false;

			const board = await parseBoard();
			const kDir = kanbanDir();
			const monitorLog = join(kDir, "monitor.log");
			const commFile = resolve(kDir, "..", "COMMUNICATION.md");
			const ts = new Date().toISOString();

			const tasks = getInProgressTasks(board);
			const results: TaskResult[] = [];
			const counts: MonitorCounts = { active: 0, stalled: 0, blocked: 0, done: 0, missing: 0 };

			for (const task of tasks) {
				// DONE? — REPORT.md exists (panopticon doesn't know about REPORT.md)
				if (await checkReportDone(task.agent)) {
					counts.done++;
					results.push({ ...task, status: "DONE", detail: "REPORT.md found" });
					continue;
				}

				// Inspect agent: PID liveness + heartbeat age from registry
				const inspection = inspectAgent(task.agent);
				let { status, detail } = inspection;

				if (status === "STALLED" && isProd && inspection.agentId) {
					const taskState = board.tasks.get(task.id);
					const lastNoteFull = taskState?.notes.at(-1) ?? "";
					const lastNoteMatch = lastNoteFull.match(/\] (.+)$/);
					const lastNoteText = lastNoteMatch?.[1] ?? "no notes yet";
					const lastNote = lastNoteText.length > 100 ? `${lastNoteText.slice(0, 100)}…` : lastNoteText;
					const nudge = [
						`Status update needed for ${task.id}: "${taskState?.title ?? task.id}"`,
						`Priority: ${taskState?.priority ?? "unknown"}`,
						`Last note: ${lastNote}`,
						`Please share progress via kanban_note or call kanban_block if stuck.`,
					].join("\n");
					const nudgeResult = await deliverNudge(inspection.agentId, nudge);
					detail += nudgeResult === "sent" ? " — nudge sent" : " — nudge failed";
				}

				if (status === "ACTIVE") counts.active++;
				else if (status === "STALLED") counts.stalled++;
				else if (status === "BLOCKED") counts.blocked++;
				else counts.missing++;

				results.push({ ...task, status, detail });
			}

			const report = formatMonitorReport(ts, results, counts);

			// Append to monitor.log (non-fatal)
			try {
				const logLines = [
					`${ts} CHECK start`,
					...results.map((r) => `${ts} ${r.id} agent=${r.agent} status=${r.status} detail=${r.detail.replace(/\n/g, " ")}`),
					`${ts} SUMMARY active=${counts.active} stalled=${counts.stalled} blocked=${counts.blocked} done=${counts.done} missing=${counts.missing}`,
				];
				await appendFile(monitorLog, `${logLines.join("\n")}\n`, "utf-8");
			} catch { /* non-fatal */ }

			// Alert COMMUNICATION.md if issues detected (non-fatal)
			if (counts.stalled > 0 || counts.blocked > 0) try {
				const issues = results.filter((r) => r.status === "STALLED" || r.status === "BLOCKED");
				await appendFile(commFile, [
					`[TO: lead] [FROM: kanban-monitor] ${ts} — ${counts.blocked} blocked, ${counts.stalled} stalled`,
					...issues.map((r) => `  ${r.id} (${r.agent}): ${r.status} — ${r.detail}`),
					"",
				].join("\n"), "utf-8");
			} catch { /* non-fatal */ }

			return result(report, { timestamp: ts, counts, tasks: results, prod: isProd });
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
			task_id: TASK_ID_SCHEMA,
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

			const task = await getTask(task_id);
			if (task.col !== "blocked") {
				throw new Error(
					`Task ${task_id} is in '${task.col}' column, not 'blocked'. Cannot unblock.`,
				);
			}

			const ts = nowZ();
			await logAppend(`${ts} UNBLOCK ${task_id} ${agent} resolution="${reason}"`);
			await logAppend(`${ts} MOVE ${task_id} ${agent} from=blocked to=todo`);

			return result(`Unblocked ${task_id}, moved to todo`, { task_id, agent, reason });
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
			task_id: TASK_ID_SCHEMA,
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

			const task = await getTask(task_id);
			if (["in-progress", "blocked", "done"].includes(task.col)) {
				throw new Error(
					`Cannot move task ${task_id} from '${task.col}' column. ` +
					`Can only move from backlog or todo.`,
				);
			}

			const from = task.col;
			const ts = nowZ();
			await logAppend(`${ts} MOVE ${task_id} ${agent} from=${from} to=${to}`);

			return result(`Moved ${task_id} from ${from} to ${to}`, { task_id, agent, from, to });
		},
	});

	// ── kanban_delete ───────────────────────────────────────────────
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
				description: 'Agent name performing the deletion (lowercase, hyphens only)',
			}),
			reason: Type.Optional(
				Type.String({
					description: 'Optional reason for deletion (e.g. "duplicate of T-042", "no longer needed")',
					default: "",
				}),
			),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const { task_id, agent } = params;
			const reason = params.reason ?? "";

			validateTaskId(task_id);

			const task = await getTask(task_id);
			if (task.deleted) {
				throw new Error(`Task ${task_id} has already been deleted`);
			}
			if (["in-progress", "blocked"].includes(task.col)) {
				throw new Error(
					`Cannot delete task ${task_id}: it is currently in '${task.col}'. ` +
					`Complete or unblock the task before deleting it.`,
				);
			}

			const ts = nowZ();
			const reasonSuffix = reason ? ` reason="${reason}"` : "";
			await logAppend(`${ts} DELETE ${task_id} ${agent}${reasonSuffix}`);

			return result(
				`Deleted ${task_id} (was in '${task.col}')${reason ? `: ${reason}` : ""}.\nThe task will no longer appear in kanban_snapshot.`,
				{ task_id, agent, reason, previousCol: task.col },
			);
		},
	});

	// ── kanban_compact ──────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_compact",
		label: "Kanban Compact",
		description:
			"Compact board.log by rewriting it with minimal events to reconstruct the current state. " +
			"Creates a timestamped backup before rewriting. Preserves all BLOCK/UNBLOCK diagnostic history " +
			"and recent notes. Drops notes for done tasks older than 7 days.",
		promptSnippet: "Compact the kanban board log to reduce event count",
		parameters: Type.Object({}),

		async execute(_toolCallId, _params, _signal): Promise<ToolResult> {
			const logPath = boardLogPath();
			const raw = await readFile(logPath, "utf-8");
			const originalLines = raw.split("\n").filter((l) => l.trim());
			const eventsBefore = originalLines.length;
			const board = await parseBoard();

			// Backup
			const backupTs = nowZ().replace(/:/g, "-");
			const backupPath = `${logPath}.bak.${backupTs}`;
			await writeFile(backupPath, raw, "utf-8");

			// Extract BLOCK/UNBLOCK events per task from original log
			const blockHistory = new Map<string, string[]>();
			for (const line of originalLines) {
				const parts = line.split(/\s+/);
				const event = parts[1] ?? "";
				const tid = parts[2] ?? "";
				if (event === "BLOCK" || event === "UNBLOCK") {
					if (!blockHistory.has(tid)) blockHistory.set(tid, []);
					blockHistory.get(tid)?.push(line);
				}
			}

			const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
			const newLines: string[] = [];
			const ts = nowZ();

			for (const tid of board.order) {
				const task = board.tasks.get(tid);
				if (!task || task.deleted) continue;

				// 1. CREATE
				newLines.push(`${task.createdAt} CREATE ${tid} compact title="${task.title}" priority="${task.priority}" tags="${task.tags}"`);

				// 2. BLOCK/UNBLOCK diagnostic history (preserved verbatim)
				const bh = blockHistory.get(tid);
				if (bh) newLines.push(...bh);

				// 3. Column-specific state reconstruction
				switch (task.col) {
					case "todo":
						newLines.push(`${ts} MOVE ${tid} compact from=backlog to=todo`);
						break;
					case "in-progress":
						newLines.push(`${ts} MOVE ${tid} compact from=backlog to=in-progress`);
						if (task.claimed) {
							const expires = task.expires || new Date(Date.now() + 7_200_000).toISOString();
							newLines.push(`${ts} CLAIM ${tid} ${task.claimAgent || "unknown"} expires=${expires}`);
						}
						break;
					case "blocked":
						newLines.push(`${ts} MOVE ${tid} compact from=backlog to=blocked`);
						break;
					case "done":
						newLines.push(`${task.completedAt || ts} COMPLETE ${tid} ${task.doneAgent || "unknown"} duration=${task.duration || "unknown"}`);
						break;
					// backlog: no additional events needed
				}

				// 4. Notes (all for active tasks; 7-day cutoff for done)
				const keepAllNotes = task.col !== "done";
				for (const note of task.notes) {
					const noteMatch = note.match(/^(\S+)\s+\[([^\]]+)\]\s+(.*)$/);
					if (!noteMatch) continue;
					const [, noteTs, noteAgent, noteText] = noteMatch;
					if (keepAllNotes || (noteTs ?? "") >= sevenDaysAgo) {
						newLines.push(`${noteTs} NOTE ${tid} ${noteAgent} text="${noteText}"`);
					}
				}
			}

			// Audit trail
			const eventsAfter = newLines.length + 1;
			newLines.push(`${ts} COMPACT T-000 compact events_before=${eventsBefore} events_after=${eventsAfter}`);

			await writeFile(logPath, `${newLines.join("\n")}\n`, "utf-8");

			const tasksPreserved = [...board.tasks.values()].filter((t) => !t.deleted).length;

			return result(
				`Compacted board.log: ${eventsBefore} \u2192 ${eventsAfter} events (${tasksPreserved} tasks preserved)\nBackup: ${backupPath}`,
				{ eventsBefore, eventsAfter, tasksPreserved, backupPath },
			);
		},
	});

	// ── kanban_edit ────────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_edit",
		label: "Kanban Edit",
		description:
			"Update title, priority, or tags on an existing task. " +
			"Task must be in backlog or todo (not in-progress, blocked, or done). " +
			"At least one field must be provided.",
		promptSnippet: "Edit a kanban task's title, priority, or tags",
		parameters: Type.Object({
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({
				description: 'Agent name performing the edit (lowercase, hyphens only)',
			}),
			title: Type.Optional(
				Type.String({ description: 'New task title' }),
			),
			priority: Type.Optional(
				Type.String({
					description: 'New priority: critical | high | medium | low',
					enum: ["critical", "high", "medium", "low"],
				}),
			),
			tags: Type.Optional(
				Type.String({ description: 'New comma-separated tags' }),
			),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const { task_id, agent } = params;

			validateTaskId(task_id);

			if (!params.title && !params.priority && !params.tags) {
				throw new Error("At least one of title, priority, or tags must be provided");
			}

			const task = await getTask(task_id);
			if (!["backlog", "todo"].includes(task.col)) {
				throw new Error(
					`Task ${task_id} is in '${task.col}' column. Can only edit tasks in backlog or todo.`,
				);
			}

			// Build event with only changed fields
			const changes: string[] = [];
			const changed: Record<string, string> = {};
			if (params.title && params.title !== task.title) {
				changes.push(`title="${params.title}"`);
				changed.title = params.title;
			}
			if (params.priority && params.priority !== task.priority) {
				changes.push(`priority="${params.priority}"`);
				changed.priority = params.priority;
			}
			if (params.tags && params.tags !== task.tags) {
				changes.push(`tags="${params.tags}"`);
				changed.tags = params.tags;
			}

			if (changes.length === 0) {
				return result(`No changes needed for ${task_id} (values already match)`, { task_id, agent, changed: {} });
			}

			const ts = nowZ();
			await logAppend(`${ts} EDIT ${task_id} ${agent} ${changes.join(" ")}`);

			return result(
				`Edited ${task_id}: ${changes.join(", ")}`,
				{ task_id, agent, changed },
			);
		},
	});

	// ── kanban_reassign ───────────────────────────────────────────
	pi.registerTool({
		name: "kanban_reassign",
		label: "Kanban Reassign",
		description:
			"Transfer an in-progress task from one agent to another. " +
			"Unclaims from the current agent and claims for the new agent with a fresh 2h expiry.",
		promptSnippet: "Reassign an in-progress kanban task to a different agent",
		parameters: Type.Object({
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({
				description: 'Agent performing the reassignment (e.g. "lead")',
			}),
			new_agent: Type.String({
				description: 'Agent receiving the task (lowercase, hyphens only)',
			}),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const { task_id, agent, new_agent } = params;

			validateTaskId(task_id);

			const task = await getTask(task_id);
			if (task.col !== "in-progress") {
				throw new Error(
					`Task ${task_id} is in '${task.col}' column. Can only reassign in-progress tasks.`,
				);
			}

			const oldAgent = task.claimAgent || "unknown";
			const ts = nowZ();
			const expires = new Date(Date.now() + 7_200_000).toISOString();

			await logAppend(`${ts} UNCLAIM ${task_id} ${oldAgent}`);
			await logAppend(`${ts} CLAIM ${task_id} ${new_agent} expires=${expires}`);

			return result(
				`Reassigned ${task_id}: ${oldAgent} \u2192 ${new_agent}`,
				{ task_id, agent, oldAgent, newAgent: new_agent, expires },
			);
		},
	});
}
