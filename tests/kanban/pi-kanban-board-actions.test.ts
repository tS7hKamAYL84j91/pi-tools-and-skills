/** Board action allocation tests: next-id under the lock, sequential and concurrent. */
import { describe, expect, it } from "vitest";
import { createTask, createTaskWithNextId } from "../../extensions/pi-kanban/board-actions.js";
import { setupTempKanbanDir } from "./kanban-test-helpers.js";

const harness = setupTempKanbanDir("kanban-board-actions-test-");

describe("board action id allocation", () => {
	it("allocates the next free id under the board lock, sequentially", async () => {
		harness.writeBoardLog('2026-01-01T00:00:00Z CREATE T-001 lead title="Seed" priority="medium" tags=""\n');
		const first = await createTaskWithNextId({ agent: "lead", title: "First", priority: "medium" });
		const second = await createTaskWithNextId({ agent: "lead", title: "Second", priority: "medium" });
		expect(first.taskId).toBe("T-002");
		expect(first.fileWarning).toBeUndefined();
		expect(second.taskId).toBe("T-003");
		expect(harness.readBoardLog()).toContain('CREATE T-002 lead title="First"');
		expect(harness.readBoardLog()).toContain('CREATE T-003 lead title="Second"');
		expect(harness.readTaskFile("T-003")).toContain('title: "Second"');
	});

	it("gives concurrent creators distinct ids — no retry loops on message text", async () => {
		harness.writeBoardLog('2026-01-01T00:00:00Z CREATE T-001 lead title="Seed" priority="medium" tags=""\n');
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
		harness.writeBoardLog('2026-01-01T00:00:00Z CREATE T-001 lead title="Seed" priority="medium" tags=""\n');
		await expect(
			createTask({ taskId: "T-001", agent: "lead", title: "Dup", priority: "medium" }),
		).rejects.toThrow(/already exists/);
	});
});