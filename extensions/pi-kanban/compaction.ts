/**
 * Kanban board.log compaction.
 *
 * Rewrites board.log to a minimal reconstruction of current state, preserving
 * BLOCK/UNBLOCK diagnostic history and recent notes. Runs only when explicitly
 * requested through kanban_compact; viewing and completing tasks do not compact.
 */

import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../../lib/file-persistence.js";

import {
	boardLogPath,
	escapeLogValue,
	nowZ,
	parseBoard,
} from "./board.js";
import { withBoardLock } from "./board-transactions.js";

// ── Re-entrance guard ────────────────────────────────────────────

/** Prevent overlapping explicit compaction requests. */
let compacting = false;

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
 */
async function runCompactionLocked(): Promise<CompactionResult> {
	const logPath = boardLogPath();
	const raw = await readFile(logPath, "utf-8");
	const originalLines = raw.split("\n").filter((l) => l.trim());
	const eventsBefore = originalLines.length;
	const board = await parseBoard();

	// Backup before touching anything
	const backupTs = nowZ().replace(/:/g, "-");
	const archiveDir = join(dirname(logPath), "archive");
	await mkdir(archiveDir, { recursive: true });
	const backupPath = join(archiveDir, `board.log.bak.${backupTs}-${randomUUID()}`);
	await writeFileAtomic(backupPath, raw, { encoding: "utf-8" });

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

	const sevenDaysAgo = new Date(
		Date.now() - 7 * 24 * 60 * 60 * 1000,
	).toISOString();
	const newLines: string[] = [];
	const ts = nowZ();

	for (const tid of board.order) {
		const task = board.tasks.get(tid);
		if (!task || task.deleted) continue;
		const descPart = task.description
			? ` description="${escapeLogValue(task.description)}"`
			: "";
		newLines.push(
			`${task.createdAt} CREATE ${tid} compact title="${escapeLogValue(task.title)}" priority="${task.priority}" tags="${escapeLogValue(task.tags)}"${descPart}`,
		);
		const bh = blockHistory.get(tid);
		if (bh) newLines.push(...bh);

		switch (task.col) {
			case "todo":
				newLines.push(`${ts} MOVE ${tid} compact from=backlog to=todo`);
				break;
			case "in-progress":
				newLines.push(`${ts} MOVE ${tid} compact from=backlog to=in-progress`);
				if (task.claimed) {
					const expires =
						task.expires || new Date(Date.now() + 7_200_000).toISOString();
					newLines.push(
						`${ts} CLAIM ${tid} ${task.claimAgent || "unknown"} expires=${expires}`,
					);
				}
				break;
			case "blocked":
				newLines.push(`${ts} MOVE ${tid} compact from=backlog to=blocked`);
				break;
			case "done":
			{
				const checksPart = task.checks.length > 0 ? ` checks="${escapeLogValue(JSON.stringify(task.checks.map((c) => ({ command: c.command, result: c.result, exit_code: c.exitCode }))))}"` : "";
				const verificationPart = task.verificationRequired ? ` verification_required=true` : "";
				newLines.push(
					`${task.completedAt || ts} COMPLETE ${tid} ${task.doneAgent || "unknown"} duration=${task.duration || "unknown"}${verificationPart}${checksPart}`,
				);
			}
			break;
		}

		const keepAllNotes = task.col !== "done";
		for (const note of task.notes) {
			const noteMatch = note.match(/^(\S+)\s+\[([^\]]+)\]\s+(.*)$/);
			if (!noteMatch) continue;
			const [, noteTs, noteAgent, noteText] = noteMatch;
			if (keepAllNotes || (noteTs ?? "") >= sevenDaysAgo) {
				newLines.push(
					`${noteTs} NOTE ${tid} ${noteAgent} text="${escapeLogValue(noteText ?? "")}"`,
				);
			}
		}
	}

	const tasksPreserved = [...board.tasks.values()].filter(
		(t) => !t.deleted,
	).length;
	const eventsAfter = newLines.length + 1;
	newLines.push(
		`${ts} COMPACT T-000 compact events_before=${eventsBefore} events_after=${eventsAfter}`,
	);
	await writeFileAtomic(logPath, `${newLines.join("\n")}\n`, { encoding: "utf-8" });

	return { eventsBefore, eventsAfter, backupPath, tasksPreserved };
}

/**
 * Manual compaction entry point used by the kanban_compact tool.
 * Throws if a compaction is already in progress.
 */
export async function runManualCompaction(): Promise<CompactionResult> {
	if (compacting)
		throw new Error("Compaction is already in progress — try again shortly");
	compacting = true;
	try {
		return await withBoardLock(() => runCompactionLocked());
	} finally {
		compacting = false;
	}
}
