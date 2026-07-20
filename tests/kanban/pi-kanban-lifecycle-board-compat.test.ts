import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseBoard } from "../../extensions/pi-kanban/board.js";
import {
	persistedTaskColumn,
	planTaskLifecycleTransition,
	TASK_LIFECYCLE_EVENTS,
	type TaskLifecycleContext,
	type TaskLifecycleEvent,
} from "../../extensions/pi-kanban/lifecycle.js";

let tmpDir: string;
let previousKanbanDir: string | undefined;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "kanban-lifecycle-compat-"));
	mkdirSync(join(tmpDir, "tasks"), { recursive: true });
	previousKanbanDir = process.env.KANBAN_DIR;
	process.env.KANBAN_DIR = tmpDir;
});

afterEach(() => {
	if (previousKanbanDir === undefined) delete process.env.KANBAN_DIR;
	else process.env.KANBAN_DIR = previousKanbanDir;
	rmSync(tmpDir, { recursive: true, force: true });
});

function writeLog(lines: string[]): void {
	writeFileSync(join(tmpDir, "board.log"), `${lines.join("\n")}\n`, "utf8");
}

function parseKv(fields: string[]): Record<string, string> {
	const kv: Record<string, string> = {};
	for (const field of fields) {
		const index = field.indexOf("=");
		if (index > 0) kv[field.slice(0, index)] = field.slice(index + 1).replace(/^"|"$/g, "");
	}
	return kv;
}

function isKnownLifecycleEvent(value: string): value is TaskLifecycleEvent {
	return (TASK_LIFECYCLE_EVENTS as readonly string[]).includes(value);
}

function foldLifecycle(lines: readonly string[]): Map<string, TaskLifecycleContext> {
	const contexts = new Map<string, TaskLifecycleContext>();
	for (const line of lines) {
		const [timestamp, event, taskId, _agent, ...fields] = line.split(/\s+/);
		if (!timestamp || !event || !taskId || !/^T-\d+$/.test(taskId) || !isKnownLifecycleEvent(event)) continue;
		const current = contexts.get(taskId) ?? {};
		const planned = planTaskLifecycleTransition(current, { event, to: parseKv(fields).to });
		if (planned.ok) contexts.set(taskId, { state: planned.state, deleted: planned.deleted, claimed: planned.claimed });
	}
	return contexts;
}

describe("pi-kanban lifecycle compatibility diagnostics", () => {
	it("derives helper lifecycle states that match parsed board columns", async () => {
		const lines = [
			'2026-01-01T00:00:00Z CREATE T-100 lead title="In progress" priority="high" tags=""',
			"2026-01-01T00:01:00Z MOVE T-100 lead from=backlog to=todo",
			"2026-01-01T00:02:00Z CLAIM T-100 worker expires=2026-01-01T02:02:00Z",
			"2026-01-01T00:02:00Z MOVE T-100 worker from=todo to=in-progress",
			'2026-01-01T00:00:00Z CREATE T-101 lead title="Blocked" priority="medium" tags=""',
			"2026-01-01T00:01:00Z MOVE T-101 lead from=backlog to=todo",
			"2026-01-01T00:02:00Z CLAIM T-101 worker expires=2026-01-01T02:02:00Z",
			"2026-01-01T00:02:00Z MOVE T-101 worker from=todo to=in-progress",
			'2026-01-01T00:03:00Z BLOCK T-101 worker reason="waiting"',
			"2026-01-01T00:03:00Z MOVE T-101 worker from=in-progress to=blocked",
			'2026-01-01T00:00:00Z CREATE T-102 lead title="Done" priority="low" tags=""',
			"2026-01-01T00:01:00Z MOVE T-102 lead from=backlog to=todo",
			"2026-01-01T00:02:00Z CLAIM T-102 worker expires=2026-01-01T02:02:00Z",
			"2026-01-01T00:02:00Z MOVE T-102 worker from=todo to=in-progress",
			"2026-01-01T00:03:00Z COMPLETE T-102 worker duration=1h",
			"2026-01-01T00:03:00Z MOVE T-102 worker from=in-progress to=done",
			'2026-01-01T00:00:00Z CREATE T-103 lead title="Deleted" priority="low" tags=""',
			"2026-01-01T00:01:00Z DELETE T-103 lead",
		];
		writeLog(lines);

		const board = await parseBoard();
		const lifecycle = foldLifecycle(lines);

		for (const taskId of ["T-100", "T-101", "T-102", "T-103"]) {
			const task = board.tasks.get(taskId);
			const interpreted = lifecycle.get(taskId);
			expect(task, taskId).toBeDefined();
			expect(interpreted, taskId).toBeDefined();
			if (task && interpreted?.state) expect(task.col).toBe(persistedTaskColumn(interpreted.state));
			expect(task?.deleted).toBe(interpreted?.deleted ?? false);
		}
		expect(lifecycle.get("T-100")).toMatchObject({ state: "in_progress", claimed: true });
		expect(lifecycle.get("T-101")).toMatchObject({ state: "blocked", claimed: false });
		expect(lifecycle.get("T-102")).toMatchObject({ state: "done", claimed: false });
		expect(lifecycle.get("T-103")).toMatchObject({ state: "backlog", deleted: true });
	});

	it("keeps unknown log events and malformed transitions non-authoritative", async () => {
		const lines = [
			'2026-01-01T00:00:00Z CREATE T-200 lead title="Known" priority="low" tags=""',
			"2026-01-01T00:01:00Z BOGUS T-200 lead value=ignored",
			"2026-01-01T00:02:00Z SNAPSHOT T-SYS orchestrator seq=2",
		];
		writeLog(lines);

		const board = await parseBoard();
		const lifecycle = foldLifecycle(lines);

		expect(board.tasks.get("T-200")?.col).toBe("backlog");
		expect(lifecycle.get("T-200")).toMatchObject({ state: "backlog", deleted: false });
		expect(planTaskLifecycleTransition({ state: "todo" }, { event: "MOVE", to: "review" })).toMatchObject({ ok: false, reason: "MOVE requires a recognized target state" });
	});

	it("handles unrecognized priorities gracefully and falls back to medium if omitted", async () => {
		const lines = [
			'2026-01-01T00:00:00Z CREATE T-300 lead title="Unknown priority" priority="super-urgent" tags=""',
			'2026-01-01T00:01:00Z CREATE T-301 lead title="No priority" tags=""',
		];
		writeLog(lines);

		const board = await parseBoard();

		// Unknown priority strings are preserved and handled gracefully by the parser
		expect(board.tasks.get("T-300")?.priority).toBe("super-urgent");

		// If omitted entirely, it defaults to medium per board.ts newTask()
		expect(board.tasks.get("T-301")?.priority).toBe("medium");
	});
});
