import { beforeEach, describe, expect, it } from "vitest";
import { parseBoard } from "../../extensions/pi-kanban/board.js";
import { callTool, setupKanbanToolHarness } from "./kanban-test-helpers.js";

const harness = setupKanbanToolHarness();

async function seedTask(taskId: string): Promise<void> {
	await callTool(harness.tools, "kanban_create", {
		task_id: taskId,
		agent: "lead",
		title: `Task ${taskId}`,
		priority: "high",
	});
	await callTool(harness.tools, "kanban_move", {
		task_id: taskId,
		agent: "lead",
		to: "todo",
	});
	await callTool(harness.tools, "kanban_claim", {
		task_id: taskId,
		agent: "worker",
	});
}

describe("kanban_complete gate_command", () => {
	beforeEach(async () => {
		await seedTask("T-801");
	});

	it("completes when gate exits 0", async () => {
		await callTool(harness.tools, "kanban_complete", {
			task_id: "T-801",
			agent: "worker",
			gate_command: "exit 0",
		});
		const board = await parseBoard();
		expect(board.tasks.get("T-801")?.col).toBe("done");
	});

	it("blocks completion when gate exits non-zero", async () => {
		await expect(
			callTool(harness.tools, "kanban_complete", {
				task_id: "T-801",
				agent: "worker",
				gate_command: "echo 'gate failed' >&2; exit 1",
			}),
		).rejects.toThrow(/gate failed/);
		const board = await parseBoard();
		expect(board.tasks.get("T-801")?.col).toBe("in-progress");
	});

	it("remains backward-compatible without gate_command", async () => {
		await callTool(harness.tools, "kanban_complete", { task_id: "T-801", agent: "worker" });
		const board = await parseBoard();
		expect(board.tasks.get("T-801")?.col).toBe("done");
	});
});
