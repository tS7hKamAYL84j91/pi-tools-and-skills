import { describe, expect, it } from "vitest";
import type { TaskState } from "../../extensions/pi-kanban/board.js";
import { tasksInColumn } from "../../extensions/pi-kanban/overlay-model.js";
import {
	clampScrollOffset,
	restoreSelectedRow,
	selectedTaskId,
} from "../../extensions/pi-kanban/overlay-selection.js";

function task(id: string, title: string, priority = "medium"): TaskState {
	return {
		id,
		col: "todo",
		deleted: false,
		title,
		priority,
		tags: "",
		description: "",
		agent: "",
		claimed: false,
		claimAgent: "",
		model: "",
		expires: "",
		reason: "",
		notes: [],
		completedAt: "",
		duration: "",
		doneAgent: "",
		verificationRequired: false,
		checks: [],
		createdAt: "2026-01-01T00:00:00.000Z",
	};
}

function board(tasks: TaskState[]) {
	return { tasks: new Map(tasks.map((item) => [item.id, item])), order: tasks.map((item) => item.id), totalEvents: tasks.length };
}

describe("Kanban overlay selection contract", () => {
	it("keeps the task ID selected through live reorder, deletion, and column move", () => {
		const original = [task("T-1", "anchor", "low"), task("T-2", "other", "high")];
		const reordered = [task("T-2", "other", "high"), task("T-1", "anchor", "low")];
		const row = restoreSelectedRow(reordered, "T-1", 0);
		expect(selectedTaskId(reordered, row)).toBe("T-1");
		expect(restoreSelectedRow([reordered[0]!], "T-1", row)).toBe(0);
		expect(restoreSelectedRow([], "T-1", row)).toBe(0);
		expect(original[0]?.id).toBe("T-1");
	});

	it("anchors a filter session across typing, no-match, backspace, enter, and escape", () => {
		const tasks = [task("T-1", "anchor"), task("T-2", "other")];
		const initialRow = 1;
		const anchor = selectedTaskId(tasks, initialRow);
		const filtered = tasksInColumn(board(tasks), "todo", "missing", false);
		expect(filtered).toHaveLength(0);
		expect(restoreSelectedRow(filtered, anchor, initialRow)).toBe(0);
		const restored = tasksInColumn(board(tasks), "todo", "", false);
		expect(selectedTaskId(restored, restoreSelectedRow(restored, anchor, 0))).toBe("T-2");
		expect(selectedTaskId(restored, restoreSelectedRow(restored, anchor, 0))).toBe("T-2");
	});

	it("clamps scroll without changing task identity", () => {
		expect(clampScrollOffset(20, 15, 5, 12)).toBe(12);
		expect(clampScrollOffset(4, 3, 5, 3)).toBe(0);
		expect(clampScrollOffset(0, 0, 5, 3)).toBe(0);
	});
});
