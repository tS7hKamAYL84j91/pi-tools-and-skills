/**
 * Unit tests for kanban snapshot rendering and overlay guard behavior.
 *
 * Tests pure functions from snapshot.ts, overlay-render.ts, and
 * the watcher widget builder.
 */

import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import {
	type BoardState,
	parseBoard,
	type TaskState,
} from "../../extensions/pi-kanban/board.js";
import {
	renderBoard,
	renderConfirmDelete,
	renderDetail,
	renderMovePicker,
} from "../../extensions/pi-kanban/overlay-render.js";
import { applyKanbanTheme, kanbanThemeHelp } from "../../extensions/pi-kanban/theme.js";
import {
	generateSnapshot,
	generateSnapshotSummary,
	generateTaskDetail,
} from "../../extensions/pi-kanban/snapshot.js";
import { buildWidgetLines } from "../../extensions/pi-kanban/watcher.js";
import { setupTempKanbanDir } from "./kanban-test-helpers.js";

const fakeTheme = {
	fg: (_name: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as import("@earendil-works/pi-coding-agent").Theme;

const recordingTheme = {
	fg: (name: string, text: string) => `<${name}>${text}</${name}>`,
	bold: (text: string) => `**${text}**`,
} as unknown as import("@earendil-works/pi-coding-agent").Theme;

describe("kanban board themes", () => {
	it("maps focus theme accents onto warning/border emphasis", () => {
		const themed = applyKanbanTheme(recordingTheme, "focus");

		expect(themed.fg("accent", "active")).toBe("<warning>active</warning>");
		expect(themed.fg("border", "|")).toBe("<accent>|</accent>");
	});

	it("maps mono theme semantic colors to text and dim only", () => {
		const themed = applyKanbanTheme(recordingTheme, "mono");

		expect(themed.fg("error", "!!")).toBe("<text>!!</text>");
		expect(themed.fg("warning", "!")).toBe("<text>!</text>");
		expect(themed.fg("border", "|")).toBe("<dim>|</dim>");
		expect(kanbanThemeHelp()).toBe("KANBAN_BOARD_THEME=default|focus|mono");
	});
});

describe("snapshot renderers", () => {
	const harness = setupTempKanbanDir("kanban-snapshot-test-");

	async function makeBoard(logContent: string): Promise<BoardState> {
		harness.writeBoardLog(logContent);
		return parseBoard();
	}

	it("compact summary includes blocked reason inline", async () => {
		const board = await makeBoard(
			[
				'2026-01-01T00:00:00Z CREATE T-001 lead title="Blocked task" priority="high" tags=""',
				"2026-01-01T00:01:00Z MOVE T-001 lead from=backlog to=todo",
				"2026-01-01T00:02:00Z CLAIM T-001 worker-1 expires=2026-01-01T02:02:00Z",
				"2026-01-01T00:02:00Z MOVE T-001 worker-1 from=todo to=in-progress",
				'2026-01-01T00:03:00Z BLOCK T-001 worker-1 reason="waiting on deploy"',
				"2026-01-01T00:03:00Z MOVE T-001 worker-1 from=in-progress to=blocked",
			].join("\n"),
		);

		const summary = generateSnapshotSummary(board);
		expect(summary).toContain("waiting on deploy");
		expect(summary).toContain("T-001");
	});

	it("compact summary does not add reason suffix for non-blocked tasks", async () => {
		const board = await makeBoard(
			[
				'2026-01-01T00:00:00Z CREATE T-002 lead title="Todo task" priority="medium" tags=""',
				"2026-01-01T00:01:00Z MOVE T-002 lead from=backlog to=todo",
			].join("\n"),
		);

		const summary = generateSnapshotSummary(board);
		expect(summary).toContain("T-002");
		expect(summary).not.toMatch(/Todo task.*\(/);
	});

	it("done label shows plain count when all fit", async () => {
		const board = await makeBoard(
			[
				'2026-01-01T00:00:00Z CREATE T-003 lead title="Done 1" priority="low" tags=""',
				"2026-01-01T00:01:00Z COMPLETE T-003 worker-1 duration=1h",
				"2026-01-01T00:01:00Z MOVE T-003 worker-1 from=in-progress to=done",
			].join("\n"),
		);

		const summary = generateSnapshotSummary(board, { showAllDone: true });
		expect(summary).toMatch(/Done \(1\)/);
		expect(summary).not.toContain("last 1 of 1");
	});

	it("done label shows last N of M when overflow", async () => {
		const lines: string[] = [];
		for (let i = 1; i <= 6; i++) {
			const id = `T-${String(i).padStart(3, "0")}`;
			lines.push(
				`2026-01-01T00:0${i}:00Z CREATE ${id} lead title="Done ${i}" priority="low" tags=""`,
			);
			lines.push(`2026-01-01T00:1${i}:00Z COMPLETE ${id} worker-1 duration=1h`);
			lines.push(
				`2026-01-01T00:1${i}:00Z MOVE ${id} worker-1 from=in-progress to=done`,
			);
		}
		const board = await makeBoard(lines.join("\n"));

		const summary = generateSnapshotSummary(board, { showAllDone: true });
		expect(summary).toContain("last 5 of 6");
	});

	it("full snapshot shows plain done count when ≤10", async () => {
		const board = await makeBoard(
			[
				'2026-01-01T00:00:00Z CREATE T-004 lead title="Done A" priority="low" tags=""',
				"2026-01-01T00:01:00Z COMPLETE T-004 worker-1 duration=1h",
				"2026-01-01T00:01:00Z MOVE T-004 worker-1 from=in-progress to=done",
			].join("\n"),
		);

		const snapshot = generateSnapshot(board, { showAllDone: true });
		expect(snapshot).toMatch(/Done \(1\)/);
		expect(snapshot).not.toContain("last 10 of 1");
	});

	it("default done view hides older tasks without changing parsed history", async () => {
		const logContent = [
			'2026-01-01T00:00:00Z CREATE T-040 lead title="Old done" priority="low" tags=""',
			"2026-01-01T00:01:00Z COMPLETE T-040 worker-1 duration=1h",
			"2026-01-01T00:01:00Z MOVE T-040 worker-1 from=in-progress to=done",
		].join("\n");
		const board = await makeBoard(logContent);

		const summary = generateSnapshotSummary(board);
		expect(summary).toContain("older hidden");
		expect(summary).not.toContain("T-040: Old done");
		expect(board.tasks.get("T-040")?.completedAt).toBe("2026-01-01T00:01:00Z");
		expect(board.totalEvents).toBe(3);
	});

	it("show-all done view recovers older completed tasks", async () => {
		const board = await makeBoard(
			[
				'2026-01-01T00:00:00Z CREATE T-041 lead title="Old done" priority="low" tags=""',
				"2026-01-01T00:01:00Z COMPLETE T-041 worker-1 duration=1h",
			].join("\n"),
		);

		const summary = generateSnapshotSummary(board, { showAllDone: true });
		expect(summary).toContain("T-041: Old done");
	});

	it("task detail includes all metadata", async () => {
		const board = await makeBoard(
			[
				'2026-01-01T00:00:00Z CREATE T-005 lead title="Detail task" priority="critical" tags="infra"',
				"2026-01-01T00:01:00Z MOVE T-005 lead from=backlog to=todo",
				"2026-01-01T00:02:00Z CLAIM T-005 worker-1 expires=2026-01-01T02:02:00Z model=gpt-4",
				"2026-01-01T00:02:00Z MOVE T-005 worker-1 from=todo to=in-progress",
			].join("\n"),
		);

		const detail = generateTaskDetail(board, "T-005");
		expect(detail).toContain("Detail task");
		expect(detail).toContain("critical");
		expect(detail).toContain("in-progress");
		expect(detail).toContain("worker-1");
	});
});

describe("widget builder", () => {
	const harness = setupTempKanbanDir("kanban-widget-test-");

	async function makeBoard(logContent: string): Promise<BoardState> {
		harness.writeBoardLog(logContent);
		return parseBoard();
	}

	it("shows blocked reason in widget when blocked tasks exist", async () => {
		const board = await makeBoard(
			[
				'2026-01-01T00:00:00Z CREATE T-001 lead title="Blocked task" priority="high" tags=""',
				"2026-01-01T00:01:00Z MOVE T-001 lead from=backlog to=todo",
				"2026-01-01T00:02:00Z CLAIM T-001 worker-1 expires=2026-01-01T02:02:00Z",
				"2026-01-01T00:02:00Z MOVE T-001 worker-1 from=todo to=in-progress",
				'2026-01-01T00:03:00Z BLOCK T-001 worker-1 reason="waiting on deploy"',
				"2026-01-01T00:03:00Z MOVE T-001 worker-1 from=in-progress to=blocked",
			].join("\n"),
		);

		const lines = buildWidgetLines(board);
		const header = lines[0] ?? "";
		expect(header).toContain("blocked 1");
		expect(header).toContain("waiting on deploy");
	});

	it("truncates long blocked reason to 30 chars", async () => {
		const longReason =
			"this is a very long reason that exceeds thirty characters easily";
		const board = await makeBoard(
			[
				'2026-01-01T00:00:00Z CREATE T-002 lead title="Blocked task" priority="high" tags=""',
				"2026-01-01T00:01:00Z MOVE T-002 lead from=backlog to=todo",
				"2026-01-01T00:02:00Z CLAIM T-002 worker-1 expires=2026-01-01T02:02:00Z",
				"2026-01-01T00:02:00Z MOVE T-002 worker-1 from=todo to=in-progress",
				`2026-01-01T00:03:00Z BLOCK T-002 worker-1 reason="${longReason}"`,
				"2026-01-01T00:03:00Z MOVE T-002 worker-1 from=in-progress to=blocked",
			].join("\n"),
		);

		const lines = buildWidgetLines(board);
		const header = lines[0] ?? "";
		expect(header).toContain("blocked 1");
		// Should be truncated, not the full 60+ char reason
		const reasonPart = header.match(/\((.+)\)/)?.[1];
		expect(reasonPart).toBeTruthy();
		expect((reasonPart ?? "").length).toBeLessThanOrEqual(30);
	});

	it("shows just blocked count when no reason provided", async () => {
		const board = await makeBoard(
			[
				'2026-01-01T00:00:00Z CREATE T-003 lead title="Blocked task" priority="high" tags=""',
				"2026-01-01T00:01:00Z MOVE T-003 lead from=backlog to=todo",
				"2026-01-01T00:02:00Z CLAIM T-003 worker-1 expires=2026-01-01T02:02:00Z",
				"2026-01-01T00:02:00Z MOVE T-003 worker-1 from=todo to=in-progress",
				`2026-01-01T00:03:00Z BLOCK T-003 worker-1 reason=""`,
				"2026-01-01T00:03:00Z MOVE T-003 worker-1 from=in-progress to=blocked",
			].join("\n"),
		);

		const lines = buildWidgetLines(board);
		const header = lines[0] ?? "";
		expect(header).toContain("blocked 1");
		// Empty reason should not show parenthetical
		expect(header).not.toMatch(/blocked 1 \(/);
	});
});

describe("overlay modal renderers", () => {
	const task = {
		id: "T-101",
		col: "todo",
		deleted: false,
		title: "Modal task",
		priority: "high",
		tags: "ui",
		description: "Keep modal behaviour stable while renderer internals change.",
		agent: "lead",
		claimed: true,
		claimAgent: "worker-1",
		model: "",
		expires: "2026-01-01T02:00:00Z",
		reason: "",
		notes: ["first note", "second note"],
		completedAt: "",
		duration: "",
		doneAgent: "",
		createdAt: "2026-01-01T00:00:00Z",
	} as TaskState;

	it("renders detail metadata and notes", () => {
		const body = renderDetail(task, 80, fakeTheme).join("\n");

		expect(body).toContain("T-101");
		expect(body).toContain("Modal task");
		expect(body).toContain("worker-1");
		expect(body).toContain("Notes (2)");
		expect(body).toContain("second note");
	});

	it("renders no-selection state consistently", () => {
		const detail = renderDetail(undefined, 80, fakeTheme).join("\n");
		const confirm = renderConfirmDelete(null, 80, fakeTheme).join("\n");
		const move = renderMovePicker(null, 80, fakeTheme).join("\n");

		expect(detail).toContain("No task selected");
		expect(confirm).toContain("No task selected");
		expect(move).toContain("No task selected");
	});

	it("renders destructive and move prompts", () => {
		const confirm = renderConfirmDelete(task, 80, fakeTheme).join("\n");
		const move = renderMovePicker(task, 80, fakeTheme).join("\n");

		expect(confirm).toContain("Delete Task?");
		expect(confirm).toContain("y confirm · esc/n cancel");
		expect(move).toContain("Move Task");
		expect(move).toContain("[2] todo (current)");
	});
});

describe("overlay render empty board", () => {
	const emptyColTasks = [[], [], [], [], []] as TaskState[][];

	it("shows empty state message when no tasks", () => {
		const view = {
			colTasks: emptyColTasks,
			activeCol: "backlog" as const,
			activeRow: 0,
			scroll: { backlog: 0, todo: 0, "in-progress": 0, blocked: 0, done: 0 },
			statusMessage: "",
		};

		const lines = renderBoard(view, 120, fakeTheme);
		const body = lines.join("\n");
		expect(body).toContain("No tasks yet");
		expect(body).toContain("kanban_create");
	});

	it("does not show empty state when tasks exist", () => {
		const task = {
			id: "T-001",
			col: "backlog",
			deleted: false,
			title: "Test task",
			priority: "medium",
			tags: "",
			description: "",
			agent: "lead",
			claimed: false,
			claimAgent: "",
			model: "",
			expires: "",
			reason: "",
			notes: [],
			completedAt: "",
			duration: "",
			doneAgent: "",
			createdAt: "2026-01-01T00:00:00Z",
		} as TaskState;

		const viewWithTask = {
			colTasks: [[task], [], [], [], []],
			activeCol: "backlog" as const,
			activeRow: 0,
			scroll: { backlog: 0, todo: 0, "in-progress": 0, blocked: 0, done: 0 },
			statusMessage: "",
		};

		const lines = renderBoard(viewWithTask, 120, fakeTheme);
		const body = lines.join("\n");
		expect(body).not.toContain("No tasks yet");
		expect(body).toContain("T-001");
		expect(body).toContain("> T-001");
		expect(body).not.toContain("▶");
	});

	it("renders filter prompt and no-match state", () => {
		const view = {
			colTasks: emptyColTasks,
			activeCol: "backlog" as const,
			activeRow: 0,
			scroll: { backlog: 0, todo: 0, "in-progress": 0, blocked: 0, done: 0 },
			statusMessage: "",
			filterQuery: "worker",
			isFiltering: true,
		};

		const body = renderBoard(view, 120, fakeTheme).join("\n");
		expect(body).toContain("Filter:");
		expect(body).toContain("worker");
		expect(body).toContain("No matching tasks for \"worker\"");
		expect(body).not.toContain("No tasks yet");
	});

	it("shows done overflow count in the board header", () => {
		const visibleDoneTasks = Array.from({ length: 10 }, (_, index) => ({
			id: `T-${String(index + 1).padStart(3, "0")}`,
			col: "done",
			deleted: false,
			title: `Done ${index + 1}`,
			priority: "low",
			tags: "",
			description: "",
			agent: "lead",
			claimed: false,
			claimAgent: "",
			model: "",
			expires: "",
			reason: "",
			notes: [],
			completedAt: "2026-01-01T00:00:00Z",
			duration: "",
			doneAgent: "lead",
			createdAt: "2026-01-01T00:00:00Z",
		})) as TaskState[];
		const view = {
			colTasks: [[], [], [], [], visibleDoneTasks],
			activeCol: "done" as const,
			activeRow: 0,
			scroll: { backlog: 0, todo: 0, "in-progress": 0, blocked: 0, done: 0 },
			statusMessage: "",
			hiddenDoneCount: 2,
		};

		const lines = renderBoard(view, 80, fakeTheme);
		expect(lines.join("\n")).toContain("DONE 10+2");
	});

	it("keeps board lines within an 80-column viewport", () => {
		const task = {
			id: "T-001",
			col: "backlog",
			deleted: false,
			title: "A long task title that should be clipped before borders break",
			priority: "medium",
			tags: "",
			description: "",
			agent: "lead",
			claimed: false,
			claimAgent: "long-agent-name",
			model: "",
			expires: "",
			reason: "",
			notes: [],
			completedAt: "",
			duration: "",
			doneAgent: "",
			createdAt: "2026-01-01T00:00:00Z",
		} as TaskState;
		const view = {
			colTasks: [[task], [], [], [], []],
			activeCol: "backlog" as const,
			activeRow: 0,
			scroll: { backlog: 0, todo: 0, "in-progress": 0, blocked: 0, done: 0 },
			statusMessage: "",
		};

		const lines = renderBoard(view, 80, fakeTheme);
		expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
	});
});
