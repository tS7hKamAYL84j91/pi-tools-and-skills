/** Board action allocation tests: next-id under the lock, sequential and concurrent. */
import { describe, expect, it } from "vitest";
import { createTask, createTaskWithNextId } from "../../extensions/pi-kanban/board-actions.js";
import { setupTempKanbanDir } from "./kanban-test-helpers.js";

const harness = setupTempKanbanDir("kanban-board-actions-test-");

const SEED = {
	v: 1,
	ts: "2026-01-01T00:00:00Z",
	type: "create",
	task_id: "T-001",
	agent: "lead",
	title: "Seed",
	priority: "medium",
	tags: "",
};

function events(): Array<Record<string, unknown>> {
	return harness
		.readEventLog()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("board action id allocation", () => {
	it("allocates the next free id under the board lock, sequentially", async () => {
		harness.writeEvents([SEED]);
		const first = await createTaskWithNextId({ agent: "lead", title: "First", priority: "medium" });
		const second = await createTaskWithNextId({ agent: "lead", title: "Second", priority: "medium" });
		expect(first.taskId).toBe("T-002");
		expect(first.fileWarning).toBeUndefined();
		expect(second.taskId).toBe("T-003");
		expect(events()).toContainEqual(
			expect.objectContaining({ type: "create", task_id: "T-002", title: "First" }),
		);
		expect(events()).toContainEqual(
			expect.objectContaining({ type: "create", task_id: "T-003", title: "Second" }),
		);
		expect(harness.readTaskFile("T-003")).toContain('title: "Second"');
	});

	it("gives concurrent creators distinct ids — no retry loops on message text", async () => {
		harness.writeEvents([SEED]);
		const results = await Promise.all([
			createTaskWithNextId({ agent: "lead", title: "A", priority: "medium" }),
			createTaskWithNextId({ agent: "lead", title: "B", priority: "medium" }),
			createTaskWithNextId({ agent: "lead", title: "C", priority: "medium" }),
		]);
		const ids = results.map((result) => result.taskId).sort();
		expect(new Set(ids).size).toBe(3);
		expect(ids).toEqual(["T-002", "T-003", "T-004"]);
	});

	it("still rejects duplicate explicit ids inside the locked transaction", async () => {
		harness.writeEvents([SEED]);
		await expect(
			createTask({ taskId: "T-001", agent: "lead", title: "Dup", priority: "medium" }),
		).rejects.toThrow(/already exists/);
	});
});
