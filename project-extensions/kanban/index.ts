/**
 * Kanban Extension — Entry Point
 *
 * Registers all kanban tools against the pi ExtensionAPI.
 * Board state, snapshot rendering, and monitoring logic
 * are in sibling modules (board.ts, snapshot.ts, monitor.ts).
 *
 * Tools:
 *   kanban_create, kanban_pick, kanban_claim, kanban_complete, kanban_block,
 *   kanban_note, kanban_snapshot, kanban_monitor, kanban_compact,
 *   kanban_edit, kanban_reassign, kanban_unblock, kanban_move,
 *   kanban_delete
 *
 * Flags:
 *   --prod — kanban_monitor delivers nudges to stalled agents
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setupWatcher } from "./watcher.js";
import { ok, type ToolResult } from "../../lib/tool-result.js";

import {
	WIP_LIMIT,
	PRIORITY_ORDER,
	kanbanDir,
	boardLogPath,
	snapshotPath,
	nowZ,
	logAppend,
	parseBoard,
	validateTaskId,
	getTask,
	writeTaskFile,
	appendTaskNote,
	rewriteTaskFile,
	type BoardState,
} from "./board.js";
import { generateSnapshot } from "./snapshot.js";
import {
	type MonitorCounts,
	type TaskResult,
	getInProgressTasks,
	checkReportDone,
	inspectAgent,
	deliverNudge,
	formatMonitorReport,
} from "./monitor.js";

// ── Helpers ─────────────────────────────────────────────────────

const TASK_ID_SCHEMA = Type.String({ description: "Task ID in T-NNN format" });

// ── Auto-compaction ─────────────────────────────────────────────

/** Re-entrance guard — prevents concurrent compaction runs. */
let compacting = false;

/**
 * Estimate how many log lines a compacted board.log would contain.
 * Used to compute the dirty ratio without doing a full dry-run.
 */
function estimateCompactedLines(board: BoardState): number {
	let count = 0;
	for (const task of board.tasks.values()) {
		if (task.deleted) continue;
		count += 1; // CREATE
		if (task.col !== "backlog") count += 1; // MOVE or COMPLETE
		if (task.col === "in-progress" && task.claimed) count += 1; // CLAIM
		count += task.notes.length; // NOTE lines
	}
	return Math.max(count + 1, 1); // +1 for the COMPACT marker
}

/**
 * Core compaction: read board.log, build minimal reconstruction,
 * back up the old log, and write the new one.
 *
 * @param agentLabel  Written as the "agent" field in the COMPACT event
 *                    ("compact" for manual, "auto-compact" for automatic)
 * @param triggerParam  Optional trigger reason appended as trigger=<value>
 */
async function runCompaction(
	agentLabel: string,
	triggerParam?: string,
): Promise<{ eventsBefore: number; eventsAfter: number; backupPath: string; tasksPreserved: number }> {
	const logPath = boardLogPath();
	const raw = await readFile(logPath, "utf-8");
	const originalLines = raw.split("\n").filter((l) => l.trim());
	const eventsBefore = originalLines.length;
	const board = await parseBoard();

	// Backup before touching anything
	const backupTs = nowZ().replace(/:/g, "-");
	const backupPath = `${logPath}.bak.${backupTs}`;
	await writeFile(backupPath, raw, "utf-8");

	// Preserve BLOCK/UNBLOCK diagnostic history per task
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
		const descPart = task.description ? ` description="${task.description.replace(/"/g, "'")}"` : "";
		newLines.push(`${task.createdAt} CREATE ${tid} compact title="${task.title}" priority="${task.priority}" tags="${task.tags}"${descPart}`);
		const bh = blockHistory.get(tid);
		if (bh) newLines.push(...bh);

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
		}

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

	const tasksPreserved = [...board.tasks.values()].filter((t) => !t.deleted).length;
	const triggerSuffix = triggerParam ? ` trigger=${triggerParam}` : "";
	const eventsAfter = newLines.length + 1;
	newLines.push(`${ts} COMPACT T-000 ${agentLabel} events_before=${eventsBefore} events_after=${eventsAfter}${triggerSuffix}`);
	await writeFile(logPath, `${newLines.join("\n")}\n`, "utf-8");

	return { eventsBefore, eventsAfter, backupPath, tasksPreserved };
}

/**
 * Check whether compaction is warranted and, if so, run it.
 *
 * Triggers if EITHER:
 *   - totalLines > 500  (absolute size threshold)
 *   - totalLines / compactedEstimate > 2.0  (dirty-ratio threshold)
 *
 * Returns { ran: false } immediately if the guard is already set or
 * neither threshold is exceeded.
 */
async function compactIfNeeded(
	board: BoardState,
	totalLines: number,
	trigger: string,
): Promise<{ ran: boolean; eventsBefore?: number; eventsAfter?: number; backupPath?: string }> {
	if (compacting) return { ran: false };

	const compactedEstimate = estimateCompactedLines(board);
	const dirtyRatio = totalLines / compactedEstimate;

	if (totalLines <= 500 && dirtyRatio <= 2.0) return { ran: false };

	compacting = true;
	try {
		const result = await runCompaction("auto-compact", trigger);
		return { ran: true, ...result };
	} finally {
		compacting = false;
	}
}

// ── Extension ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	setupWatcher(pi);

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
			const descPart = description ? ` description="${description.replace(/"/g, "'")}"` : "";
			await logAppend(`${nowZ()} CREATE ${task_id} ${agent} title="${title}" priority="${priority}" tags="${tags}"${descPart}`);
			// Write task markdown file
			await writeTaskFile(task_id, { title, description, priority, tags, agent });
			return ok(`Created ${task_id}: ${title} (priority=${priority})`, { task_id, title, priority, tags, description });
		},
	});

	// ── kanban_pick ─────────────────────────────────────────────
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
			agent: Type.String({ description: 'Agent name claiming the task (lowercase, hyphens only, e.g. "tools-worker")' }),
			model: Type.Optional(Type.String({ description: 'Model running the agent (e.g. "claude-sonnet-4-6")' })),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { agent } = params;
			const modelSuffix = params.model ? ` model=${params.model}` : "";
			const board = await parseBoard();
			const wip = [...board.tasks.values()].filter((t) => t.col === "in-progress").length;
			if (wip >= WIP_LIMIT) return ok(`WIP_LIMIT_REACHED (${wip}/${WIP_LIMIT})`, { agent, result: "WIP_LIMIT_REACHED", claimed: false });

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
			if (!bestId) return ok("NO_TASK_AVAILABLE", { agent, result: "NO_TASK_AVAILABLE", claimed: false });

			const ts = nowZ();
			const expires = new Date(Date.now() + 7_200_000).toISOString();
			const fromCol = board.tasks.get(bestId)?.col ?? "todo";
			await logAppend(`${ts} CLAIM ${bestId} ${agent} expires=${expires}${modelSuffix}`);
			await logAppend(`${ts} MOVE ${bestId} ${agent} from=${fromCol} to=in-progress`);

			const verifyBoard = await parseBoard();
			const verified = verifyBoard.tasks.get(bestId);
			if (verified && verified.claimAgent !== agent) {
				await logAppend(`${ts} UNCLAIM ${bestId} ${agent}`);
				return ok(
					`CLAIM_CONFLICT: ${bestId} was claimed by ${verified.claimAgent}. Call kanban_pick again.`,
					{ agent, result: "CLAIM_CONFLICT", claimed: false, conflictWith: verified.claimAgent },
				);
			}
			return ok(`Claimed ${bestId} for agent "${agent}".\nRun kanban_snapshot to see full task details.`, { agent, result: bestId, claimed: true });
		},
	});

	// ── kanban_claim ──────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_claim",
		label: "Kanban Claim",
		description:
			"Claim a specific task for a specific agent. " +
			"Task must be in the todo column. Moves it to in-progress. " +
			"Returns TASK_NOT_FOUND if the ID is unknown, WRONG_COLUMN if not in todo, " +
			"or WIP_LIMIT_REACHED if the 3-task in-progress cap is hit.",
		promptSnippet: "Claim a specific kanban task for a specific agent",
		parameters: Type.Object({
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({ description: 'Agent name to claim for (lowercase, hyphens only, e.g. "time-crystals")' }),
			model: Type.Optional(Type.String({ description: 'Model running the agent (e.g. "google-gemini-cli/gemini-2.5-flash")' })),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { task_id, agent } = params;
			const modelSuffix = params.model ? ` model=${params.model}` : "";
			validateTaskId(task_id);
			const board = await parseBoard();

			const task = board.tasks.get(task_id);
			if (!task || task.deleted) return ok(`TASK_NOT_FOUND: ${task_id}`, { agent, task_id, result: "TASK_NOT_FOUND", claimed: false });
			if (task.col !== "todo") return ok(`WRONG_COLUMN: ${task_id} is in '${task.col}', expected 'todo'`, { agent, task_id, result: "WRONG_COLUMN", col: task.col, claimed: false });

			const wip = [...board.tasks.values()].filter((t) => t.col === "in-progress").length;
			if (wip >= WIP_LIMIT) return ok(`WIP_LIMIT_REACHED (${wip}/${WIP_LIMIT})`, { agent, task_id, result: "WIP_LIMIT_REACHED", claimed: false });

			const ts = nowZ();
			const expires = new Date(Date.now() + 7_200_000).toISOString();
			await logAppend(`${ts} CLAIM ${task_id} ${agent} expires=${expires}${modelSuffix}`);
			await logAppend(`${ts} MOVE ${task_id} ${agent} from=todo to=in-progress`);

			const verifyBoard = await parseBoard();
			const verified = verifyBoard.tasks.get(task_id);
			if (verified && verified.claimAgent !== agent) {
				await logAppend(`${ts} UNCLAIM ${task_id} ${agent}`);
				return ok(
					`CLAIM_CONFLICT: ${task_id} was claimed by ${verified.claimAgent}. Try again.`,
					{ agent, task_id, result: "CLAIM_CONFLICT", claimed: false, conflictWith: verified.claimAgent },
				);
			}

			return ok(
				`Claimed ${task_id} ("${task.title}") for agent "${agent}".\nRun kanban_snapshot to see full task details.`,
				{ agent, task_id, title: task.title, priority: task.priority, tags: task.tags, expires, result: "CLAIMED", claimed: true },
			);
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
			await logAppend(`${ts} COMPLETE ${task_id} ${agent} duration=${duration}`);
			await logAppend(`${ts} MOVE ${task_id} ${agent} from=in-progress to=done`);
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
			await logAppend(`${ts} BLOCK ${task_id} ${agent} reason="${reason}"`);
			await logAppend(`${ts} MOVE ${task_id} ${agent} from=in-progress to=blocked`);
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
			await logAppend(`${nowZ()} NOTE ${task_id} ${agent} text="${text}"`);
			// Append note to task markdown file
			await appendTaskNote(task_id, agent, text);
			return ok(`Note added to ${task_id}`, { task_id, agent, text });
		},
	});

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

	// ── kanban_monitor ──────────────────────────────────────────
	pi.registerFlag("prod", { description: "kanban_monitor: deliver nudges to stalled agents", type: "boolean", default: false });

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
			prod: Type.Optional(Type.Boolean({ description: "Deliver a nudge to stalled agents via panopticon Maildir (default: false, or set via --prod flag)", default: false })),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const isProd = params.prod ?? (pi.getFlag("--prod") as boolean | undefined) ?? false;
			const board = await parseBoard();
			const kDir = kanbanDir();
			const monitorLog = resolve(kDir, "monitor.log");
			const ts = new Date().toISOString();

			const tasks = getInProgressTasks(board);
			const results: TaskResult[] = [];
			const counts: MonitorCounts = { active: 0, stalled: 0, blocked: 0, done: 0, missing: 0 };

			for (const task of tasks) {
				if (await checkReportDone(task.agent)) {
					counts.done++;
					results.push({ ...task, status: "DONE", detail: "REPORT.md found" });
					continue;
				}
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

			try {
				const logLines = [
					`${ts} CHECK start`,
					...results.map((r) => `${ts} ${r.id} agent=${r.agent} status=${r.status} detail=${r.detail.replace(/\n/g, " ")}`),
					`${ts} SUMMARY active=${counts.active} stalled=${counts.stalled} blocked=${counts.blocked} done=${counts.done} missing=${counts.missing}`,
				];
				await appendFile(monitorLog, `${logLines.join("\n")}\n`, "utf-8");
			} catch { /* non-fatal */ }

			return ok(report, { timestamp: ts, counts, tasks: results, prod: isProd });
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
			await logAppend(`${ts} UNBLOCK ${task_id} ${agent} resolution="${reason}"`);
			await logAppend(`${ts} MOVE ${task_id} ${agent} from=blocked to=todo`);
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
			const task = await getTask(task_id);
			if (["in-progress", "blocked", "done"].includes(task.col)) {
				throw new Error(`Cannot move task ${task_id} from '${task.col}' column. Can only move from backlog or todo.`);
			}
			const from = task.col;
			await logAppend(`${nowZ()} MOVE ${task_id} ${agent} from=${from} to=${to}`);
			return ok(`Moved ${task_id} from ${from} to ${to}`, { task_id, agent, from, to });
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
			validateTaskId(task_id);
			const task = await getTask(task_id);
			if (task.deleted) throw new Error(`Task ${task_id} has already been deleted`);
			if (["in-progress", "blocked"].includes(task.col)) {
				throw new Error(`Cannot delete task ${task_id}: it is currently in '${task.col}'. Complete or unblock the task before deleting it.`);
			}
			const reasonSuffix = reason ? ` reason="${reason}"` : "";
			await logAppend(`${nowZ()} DELETE ${task_id} ${agent}${reasonSuffix}`);
			return ok(
				`Deleted ${task_id} (was in '${task.col}')${reason ? `: ${reason}` : ""}.\nThe task will no longer appear in kanban_snapshot.`,
				{ task_id, agent, reason, previousCol: task.col },
			);
		},
	});

	// ── kanban_compact ──────────────────────────────────────────
	pi.registerTool({
		name: "kanban_compact",
		label: "Kanban Compact",
		description:
			"Compact board.log by rewriting it with minimal events to reconstruct the current state. " +
			"Creates a timestamped backup before rewriting. Preserves all BLOCK/UNBLOCK diagnostic history " +
			"and recent notes. Drops notes for done tasks older than 7 days.",
		promptSnippet: "Compact the kanban board log to reduce event count",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal): Promise<ToolResult> {
			if (compacting) throw new Error("Compaction is already in progress — try again shortly");
			compacting = true;
			try {
				const { eventsBefore, eventsAfter, backupPath, tasksPreserved } = await runCompaction("compact");
				return ok(
					`Compacted board.log: ${eventsBefore} → ${eventsAfter} events (${tasksPreserved} tasks preserved)\nBackup: ${backupPath}`,
					{ eventsBefore, eventsAfter, tasksPreserved, backupPath },
				);
			} finally {
				compacting = false;
			}
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
			if (params.title && params.title !== task.title) { changes.push(`title="${params.title}"`); changed.title = params.title; }
			if (params.priority && params.priority !== task.priority) { changes.push(`priority="${params.priority}"`); changed.priority = params.priority; }
			if (params.tags && params.tags !== task.tags) { changes.push(`tags="${params.tags}"`); changed.tags = params.tags; }
			if (params.description && params.description !== task.description) { changes.push(`description="${params.description.replace(/"/g, "'")}"`); changed.description = params.description; }
			if (changes.length === 0) return ok(`No changes needed for ${task_id} (values already match)`, { task_id, agent, changed: {} });

			await logAppend(`${nowZ()} EDIT ${task_id} ${agent} ${changes.join(" ")}`);
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

	// ── kanban_reassign ─────────────────────────────────────────
	pi.registerTool({
		name: "kanban_reassign",
		label: "Kanban Reassign",
		description: "Transfer an in-progress task from one agent to another. Unclaims from the current agent and claims for the new agent with a fresh 2h expiry.",
		promptSnippet: "Reassign an in-progress kanban task to a different agent",
		parameters: Type.Object({
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({ description: 'Agent performing the reassignment (e.g. "lead")' }),
			new_agent: Type.String({ description: "Agent receiving the task (lowercase, hyphens only)" }),
			model: Type.Optional(Type.String({ description: 'Model running the new agent (e.g. "claude-sonnet-4-6")' })),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { task_id, agent, new_agent } = params;
			const modelSuffix = params.model ? ` model=${params.model}` : "";
			validateTaskId(task_id);
			const task = await getTask(task_id);
			if (task.col !== "in-progress") throw new Error(`Task ${task_id} is in '${task.col}' column. Can only reassign in-progress tasks.`);
			const oldAgent = task.claimAgent || "unknown";
			const ts = nowZ();
			const expires = new Date(Date.now() + 7_200_000).toISOString();
			await logAppend(`${ts} UNCLAIM ${task_id} ${oldAgent}`);
			await logAppend(`${ts} CLAIM ${task_id} ${new_agent} expires=${expires}${modelSuffix}`);
			return ok(`Reassigned ${task_id}: ${oldAgent} → ${new_agent}`, { task_id, agent, oldAgent, newAgent: new_agent, expires });
		},
	});
}
