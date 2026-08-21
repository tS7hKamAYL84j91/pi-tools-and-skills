import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { BoardState, TaskState } from "../../extensions/pi-kanban/board.js";
import { tasksInColumn } from "../../extensions/pi-kanban/overlay-model.js";
import { assertProperty } from "../lib/fast-check.js";

const columnArbitrary = fc.constantFrom("backlog", "todo", "in-progress", "blocked", "done");
const titleArbitrary = fc.array(fc.constantFrom("a", "B", "0", " "), { minLength: 1, maxLength: 12 })
	.map((parts) => parts.join(""));

function task(id: string, col: TaskState["col"], title: string, deleted: boolean): TaskState {
	return {
		id, col, title, deleted, priority: "medium", claimed: false, notes: [], createdAt: "2026-01-01",
		tags: "", description: "", agent: "", claimAgent: "", model: "", expires: "", reason: "",
		completedAt: "", duration: "", doneAgent: "", verificationRequired: false, checks: [],
	};
}

describe("bounded Kanban projection properties", () => {
	it("preserves ordered, live matching tasks and bounds done history", () => {
		assertProperty(fc.property(
			fc.array(fc.tuple(columnArbitrary, titleArbitrary, fc.boolean()), { minLength: 0, maxLength: 24 }),
			fc.constantFrom("", "a", "b"),
			(entries, query) => {
				const tasks = new Map<string, TaskState>();
				const order: string[] = [];
				for (const [index, [col, title, deleted]] of entries.entries()) {
					const id = `T-${index}`;
					order.push(id);
					tasks.set(id, task(id, col, title, deleted));
				}
				const board: BoardState = { tasks, order, totalEvents: entries.length };
				for (const column of ["backlog", "todo", "in-progress", "blocked"] as const) {
					const expected = order.map((id) => tasks.get(id)).filter((candidate): candidate is TaskState =>
						candidate !== undefined && !candidate.deleted && candidate.col === column && candidate.title.toLowerCase().includes(query),
					);
					expect(tasksInColumn(board, column, query)).toEqual(expected);
				}
				const done = order.map((id) => tasks.get(id)).filter((candidate): candidate is TaskState =>
					candidate !== undefined && !candidate.deleted && candidate.col === "done" && candidate.title.toLowerCase().includes(query),
				);
				expect(tasksInColumn(board, "done", query)).toEqual(done.slice(-10).reverse());
			},
		));
	});
});
