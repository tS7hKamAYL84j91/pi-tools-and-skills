/**
 * Kanban board.events.jsonl compaction.
 *
 * Rewrites the log to a minimal reconstruction of current state, preserving
 * BLOCK/UNBLOCK diagnostic history and recent notes. Runs only when explicitly
 * requested through kanban_compact; viewing and completing tasks do not compact.
 */

import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../../lib/file-persistence.js";

import { boardLogPath, nowZ, parseBoard } from "./board.js";
import {
	KanbanEventVersionError,
	kanbanEventCodec,
	makeEvent,
	type KanbanEvent,
} from "./board-events.js";
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
 * Core compaction: read the log, build a minimal reconstruction,
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
	const backupPath = join(
		archiveDir,
		`board.events.jsonl.bak.${backupTs}-${randomUUID()}`,
	);
	await writeFileAtomic(backupPath, raw, { encoding: "utf-8" });

	// Preserve BLOCK/UNBLOCK diagnostic history per task, in original order.
	const blockHistory = new Map<string, KanbanEvent[]>();
	for (const line of originalLines) {
		let event: KanbanEvent;
		try {
			event = kanbanEventCodec.decode(line);
		} catch (error) {
			if (error instanceof KanbanEventVersionError) throw error;
			continue;
		}
		if (event.type === "block" || event.type === "unblock") {
			if (!blockHistory.has(event.task_id)) blockHistory.set(event.task_id, []);
			blockHistory.get(event.task_id)?.push(event);
		}
	}

	const sevenDaysAgo = new Date(
		Date.now() - 7 * 24 * 60 * 60 * 1000,
	).toISOString();
	const ts = nowZ();
	const newEvents: KanbanEvent[] = [];
	const compactFields = (task_id: string, at: string = ts) => ({
		ts: at,
		task_id,
		agent: "compact",
	});
	const compactMove = (task_id: string, to: string) =>
		makeEvent("move", compactFields(task_id), { from: "backlog", to });

	for (const tid of board.order) {
		const task = board.tasks.get(tid);
		if (!task || task.deleted) continue;
		newEvents.push(
			makeEvent("create", compactFields(tid, task.createdAt || ts), {
				title: task.title,
				priority: task.priority,
				tags: task.tags,
				...(task.description ? { description: task.description } : {}),
			}),
		);
		const history = blockHistory.get(tid);
		if (history) newEvents.push(...history);

		switch (task.col) {
			case "todo":
				newEvents.push(compactMove(tid, "todo"));
				break;
			case "in-progress":
				newEvents.push(compactMove(tid, "in-progress"));
				if (task.claimed) {
					const expires =
						task.expires || new Date(Date.now() + 7_200_000).toISOString();
					newEvents.push(
						makeEvent(
							"claim",
							{ ts, task_id: tid, agent: task.claimAgent || "unknown" },
							{ expires },
						),
					);
				}
				break;
			case "blocked":
				newEvents.push(compactMove(tid, "blocked"));
				break;
			case "done":
				newEvents.push(
					makeEvent(
						"complete",
						{
							ts: task.completedAt || ts,
							task_id: tid,
							agent: task.doneAgent || "unknown",
						},
						{
							duration: task.duration || "unknown",
							...(task.verificationRequired ? { verification_required: true } : {}),
							...(task.checks.length > 0
								? {
										checks: task.checks.map((check) => ({
											command: check.command,
											result: check.result,
											exit_code: check.exitCode,
										})),
									}
								: {}),
						},
					),
				);
				break;
		}

		const keepAllNotes = task.col !== "done";
		for (const note of task.notes) {
			const noteMatch = note.match(/^(\S+)\s+\[([^\]]+)\]\s+(.*)$/);
			if (!noteMatch) continue;
			const [, noteTs, noteAgent, noteText] = noteMatch;
			if (keepAllNotes || (noteTs ?? "") >= sevenDaysAgo) {
				newEvents.push(
					makeEvent(
						"note",
						{ ts: noteTs ?? ts, task_id: tid, agent: noteAgent ?? "unknown" },
						{ text: noteText ?? "" },
					),
				);
			}
		}
	}

	const tasksPreserved = [...board.tasks.values()].filter(
		(t) => !t.deleted,
	).length;
	const eventsAfter = newEvents.length;
	await writeFileAtomic(
		logPath,
		`${newEvents.map(kanbanEventCodec.encode).join("\n")}\n`,
		{ encoding: "utf-8" },
	);

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
