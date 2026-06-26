import { describe, expect, it } from "vitest";
import { parseBoard } from "../../extensions/pi-kanban/board.js";
import { buildStatusText, buildWidgetLines } from "../../extensions/pi-kanban/watcher.js";
import { setupTempKanbanDir } from "./kanban-test-helpers.js";
import {
	renderBoard,
	renderDetail,
	renderConfirmDelete,
	renderMovePicker,
	COLUMNS,
} from "../../extensions/pi-kanban/overlay-render.js";
import type { Theme } from "@earendil-works/pi-coding-agent";

function makeTheme(): Theme {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		dim: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
		strikethrough: (text: string) => text,
		inverse: (text: string) => text,
		fgColors: {},
		bgColors: {},
		mode: "light",
		color: (_name: string, text: string) => text,
		reset: () => "",
		strip: (text: string) => text,
		visibleWidth: (text: string) => text.length,
		truncateToWidth: (text: string, _width: number, _ellipsis?: string, _end?: boolean) => text,
	} as unknown as Theme;
}

describe("kanban snapshot/overlay rendering", () => {
	const harness = setupTempKanbanDir("kanban-snapshot-render-test-");

	function makeTask(
		id: string,
		col: string,
		title = "Task",
		priority = "medium",
		claimed = false,
	): {
		id: string;
		col: string;
		deleted: boolean;
		title: string;
		priority: string;
		tags: string;
		description: string;
		agent: string;
		claimed: boolean;
		claimAgent: string;
		model: string;
		expires: string;
		reason: string;
		notes: string[];
		completedAt: string;
		duration: string;
		doneAgent: string;
		createdAt: string;
	} {
		return {
			id,
			col,
			deleted: false,
			title,
			priority,
			tags: "",
			description: "",
			agent: "",
			claimed,
			claimAgent: claimed ? "worker-1" : "",
			model: "",
			expires: "",
			reason: "",
			notes: [],
			completedAt: "",
			duration: "",
			doneAgent: "",
			createdAt: "2026-01-01T00:00:00Z",
		};
	}

	function makeEmptyView() {
		return {
			colTasks: COLUMNS.map(() => []),
			activeCol: "in-progress" as const,
			activeRow: 0,
			scroll: {
				backlog: 0,
				todo: 0,
				"in-progress": 0,
				blocked: 0,
				done: 0,
			},
			statusMessage: "",
		};
	}

	it("widget renders compact one-line counts", async () => {
		harness.writeBoardLog(
			[
				'2026-01-01T00:00:00Z CREATE T-001 lead title="First" priority="high" tags=""',
				'2026-01-01T00:00:00Z CREATE T-002 lead title="Second" priority="medium" tags=""',
				"2026-01-01T00:01:00Z MOVE T-001 lead from=backlog to=todo",
				"2026-01-01T00:01:00Z CLAIM T-002 lead expires=2026-01-01T02:02:00Z",
				"2026-01-01T00:02:00Z MOVE T-002 lead from=backlog to=in-progress",
			].join("\n"),
		);
		const board = await parseBoard();
		const lines = buildWidgetLines(board);
		expect(lines).toHaveLength(1);
		const header = lines[0] ?? "";
		expect(header).toMatch(
			/^pi-kanban: wip 1\/\d+ \| todo 1 \| blocked 0 \| done 0$/,
		);
	});

	it("footer status uses the same compact counts-only text", async () => {
		harness.writeBoardLog(
			[
				'2026-01-01T00:00:00Z CREATE T-001 lead title="First" priority="high" tags=""',
				'2026-01-01T00:00:00Z CREATE T-002 lead title="Second" priority="medium" tags=""',
				"2026-01-01T00:01:00Z MOVE T-001 lead from=backlog to=todo",
				"2026-01-01T00:01:00Z CLAIM T-002 lead expires=2026-01-01T02:02:00Z",
				"2026-01-01T00:02:00Z MOVE T-002 lead from=backlog to=in-progress",
			].join("\n"),
		);
		const board = await parseBoard();
		expect(buildStatusText(board)).toMatch(
			/^pi-kanban: wip 1\/\d+ \| todo 1 \| blocked 0 \| done 0$/,
		);
	});

	it("widget shows blocked count without reason in compact header", async () => {
		harness.writeBoardLog(
			[
				'2026-01-01T00:00:00Z CREATE T-001 lead title="Blocked task" priority="high" tags=""',
				"2026-01-01T00:01:00Z MOVE T-001 lead from=backlog to=todo",
				"2026-01-01T00:02:00Z CLAIM T-001 worker-1 expires=2026-01-01T02:02:00Z",
				"2026-01-01T00:02:00Z MOVE T-001 worker-1 from=todo to=in-progress",
				'2026-01-01T00:03:00Z BLOCK T-001 worker-1 reason="waiting on deploy"',
				"2026-01-01T00:03:00Z MOVE T-001 worker-1 from=in-progress to=blocked",
			].join("\n"),
		);
		const board = await parseBoard();
		const lines = buildWidgetLines(board);
		const header = lines[0] ?? "";
		expect(header).toMatch(
			/^pi-kanban: wip 0\/\d+ \| todo 0 \| blocked 1 \| done 0$/,
		);
		expect(header).not.toContain("(");
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
		};

		const theme = makeTheme();

		it("renderBoard renders a header and empty columns", () => {
			const lines = renderBoard(makeEmptyView(), 80, theme);
			expect(lines.join("\n")).toContain("Kanban Board");
			expect(lines.join("\n")).toContain("TODO");
		});

		it("renderDetail renders selected task metadata", () => {
			const lines = renderDetail(task, 60, theme);
			const output = lines.join("\n");
			expect(output).toContain("T-101");
			expect(output).toContain("Modal task");
			expect(output).toContain("todo");
		});

		it("renderConfirmDelete renders confirmation prompt", () => {
			const lines = renderConfirmDelete(task, 60, theme);
			const output = lines.join("\n");
			expect(output).toContain("Delete");
			expect(output).toContain("T-101");
		});

		it("renderMovePicker renders move options", () => {
			const lines = renderMovePicker(task, 60, theme);
			const output = lines.join("\n");
			expect(output).toContain("Move Task");
			expect(output).toContain("[1] backlog");
			expect(output).toContain("[2] todo");
		});

		it("renderBoard highlights active column", () => {
			const view = {
				...makeEmptyView(),
				activeCol: "blocked" as const,
			};
			const lines = renderBoard(view, 80, theme);
			const output = lines.join("\n");
			expect(output).toContain("BLOCKED");
		});

		it("renderBoard shows card selection", () => {
			const selected = makeTask("T-201", "todo", "X-S", "critical", true);
			const view = {
				...makeEmptyView(),
				colTasks: COLUMNS.map((c) => (c === "todo" ? [selected] : [])),
				activeCol: "todo" as const,
				activeRow: 0,
			};
			const lines = renderBoard(view, 120, theme);
			const output = lines.join("\n");
			expect(output).toContain("T-201");
			expect(output).toContain("X-S");
		});

		it("renderDetail shows notes section", () => {
			const taskWithNotes = {
				...task,
				notes: ["2026-01-01T00:00:00Z [lead] First note"],
			};
			const lines = renderDetail(taskWithNotes, 60, theme);
			const output = lines.join("\n");
			expect(output).toContain("Notes");
			expect(output).toContain("First note");
		});
	});
});
