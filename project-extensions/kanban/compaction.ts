/**
 * Kanban board.log compaction.
 *
 * Rewrites board.log to a minimal reconstruction of current state, preserving
 * BLOCK/UNBLOCK diagnostic history and recent notes. Used both automatically
 * (after kanban_complete / kanban_snapshot) and manually (kanban_compact tool).
 *
 * Auto-compaction triggers if EITHER:
 *   - totalLines > 500           (absolute size threshold)
 *   - dirty ratio > 2.0          (totalLines / compactedEstimate)
 *
 * A module-level re-entrance guard prevents concurrent runs across both the
 * automatic and manual paths.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
	type BoardState,
	boardLogPath,
	nowZ,
	parseBoard,
} from "./board.js";

// ── Re-entrance guard ────────────────────────────────────────────

/** Shared between auto and manual compaction; prevents concurrent runs. */
let compacting = false;

// ── Estimation ───────────────────────────────────────────────────

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

// ── Core compaction ──────────────────────────────────────────────

interface CompactionResult {
	eventsBefore: number;
	eventsAfter: number;
	backupPath: string;
	tasksPreserved: number;
}

/**
 * Core compaction: read board.log, build minimal reconstruction,
 * back up the old log, and write the new one.
 *
 * @param agentLabel  Written as the "agent" field in the COMPACT event
 *                    ("compact" for manual, "auto-compact" for automatic)
 * @param triggerParam  Optional trigger reason appended as trigger=<value>
 */
async function runCompaction(agentLabel: string, triggerParam?: string): Promise<CompactionResult> {
	const logPath = boardLogPath();
	const raw = await readFile(logPath, "utf-8");
	const originalLines = raw.split("\n").filter((l) => l.trim());
	const eventsBefore = originalLines.length;
	const board = await parseBoard();

	// Backup before touching anything
	const backupTs = nowZ().replace(/:/g, "-");
	const archiveDir = join(dirname(logPath), "archive");
	await mkdir(archiveDir, { recursive: true });
	const backupPath = join(archiveDir, `board.log.bak.${backupTs}`);
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

// ── Public entry points ──────────────────────────────────────────

/**
 * Check whether compaction is warranted and, if so, run it.
 *
 * Returns { ran: false } immediately if the guard is already set or
 * neither threshold is exceeded.
 */
export async function compactIfNeeded(
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

/**
 * Manual compaction entry point used by the kanban_compact tool.
 * Throws if a compaction (auto or manual) is already in progress.
 */
export async function runManualCompaction(): Promise<CompactionResult> {
	if (compacting) throw new Error("Compaction is already in progress — try again shortly");
	compacting = true;
	try {
		return await runCompaction("compact");
	} finally {
		compacting = false;
	}
}
