import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseBoard } from "../../extensions/pi-kanban/board.js";
import { callTool, setupKanbanToolHarness } from "./kanban-test-helpers.js";

const harness = setupKanbanToolHarness();
const originalGateCommand = process.env.KANBAN_GATE_COMMAND;

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

describe("kanban_complete operator-configured gate", () => {
	beforeEach(async () => {
		delete process.env.KANBAN_GATE_COMMAND;
		await seedTask("T-801");
	});

	afterEach(() => {
		if (originalGateCommand === undefined) {
			delete process.env.KANBAN_GATE_COMMAND;
		} else {
			process.env.KANBAN_GATE_COMMAND = originalGateCommand;
		}
	});

	it("completes when the configured gate exits 0", async () => {
		process.env.KANBAN_GATE_COMMAND = "exit 0";
		await callTool(harness.tools, "kanban_complete", {
			task_id: "T-801",
			agent: "worker",
		}, harness.tmpDir);
		const board = await parseBoard();
		expect(board.tasks.get("T-801")?.col).toBe("done");
	});

	it("blocks completion when the configured gate exits non-zero", async () => {
		process.env.KANBAN_GATE_COMMAND = "echo 'gate failed' >&2; exit 1";
		await expect(
			callTool(harness.tools, "kanban_complete", {
				task_id: "T-801",
				agent: "worker",
			}, harness.tmpDir),
		).rejects.toThrow(/gate failed/);
		const board = await parseBoard();
		expect(board.tasks.get("T-801")?.col).toBe("in-progress");
	});

	it("completes without a configured gate", async () => {
		await callTool(harness.tools, "kanban_complete", { task_id: "T-801", agent: "worker" });
		const board = await parseBoard();
		expect(board.tasks.get("T-801")?.col).toBe("done");
	});

	it("ignores a model-supplied gate_command extra field", async () => {
		await callTool(harness.tools, "kanban_complete", {
			task_id: "T-801",
			agent: "worker",
			gate_command: "exit 1",
		});
		const board = await parseBoard();
		expect(board.tasks.get("T-801")?.col).toBe("done");
	});
});
