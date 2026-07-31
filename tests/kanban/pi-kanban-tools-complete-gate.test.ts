/**
 * Regression tests for pi-kanban stop-and-fix completion gate.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callTool, setupKanbanToolHarness } from "./kanban-test-helpers.js";

const harness = setupKanbanToolHarness();

describe("kanban_complete verification gate", () => {
	let previousRequireEvidence: string | undefined;

	beforeEach(() => {
		previousRequireEvidence = process.env.KANBAN_REQUIRE_CHECK_EVIDENCE;
	});

	afterEach(() => {
		if (previousRequireEvidence === undefined) {
			delete process.env.KANBAN_REQUIRE_CHECK_EVIDENCE;
		} else {
			process.env.KANBAN_REQUIRE_CHECK_EVIDENCE = previousRequireEvidence;
		}
	});

	async function seedTask(
		taskId: string,
		options: { verificationRequired?: boolean } = {},
	): Promise<void> {
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
			agent: "worker-1",
		});
		if (options.verificationRequired) {
			await callTool(harness.tools, "kanban_edit", {
				task_id: taskId,
				agent: "lead",
				tags: "verify",
			});
		}
	}

	it("completes an unverified task without checks by default", async () => {
		await seedTask("T-100");
		const result = await callTool(harness.tools, "kanban_complete", {
			task_id: "T-100",
			agent: "worker-1",
			duration: "45m",
		});
		expect(result.isError).toBeFalsy();
		expect(result.content[0]?.text).toContain("Completed T-100");
		expect(harness.readBoardLog()).toContain("COMPLETE T-100 worker-1 duration=45m");
	});

	it("rejects completion by non-claiming agent", async () => {
		await seedTask("T-101");
		await expect(
			callTool(harness.tools, "kanban_complete", {
				task_id: "T-101",
				agent: "worker-2",
			}),
		).rejects.toThrow(/not the claimed owner/);
		expect(harness.readBoardLog()).not.toContain("COMPLETE T-101");
	});

	it("rejects missing evidence when KANBAN_REQUIRE_CHECK_EVIDENCE=1", async () => {
		process.env.KANBAN_REQUIRE_CHECK_EVIDENCE = "1";
		await seedTask("T-102");
		await expect(
			callTool(harness.tools, "kanban_complete", {
				task_id: "T-102",
				agent: "worker-1",
			}),
		).rejects.toThrow(/requires verification evidence/);
		expect(harness.readBoardLog()).not.toContain("COMPLETE T-102");
	});

	it("rejects failed check exit_code", async () => {
		await seedTask("T-103");
		await expect(
			callTool(harness.tools, "kanban_complete", {
				task_id: "T-103",
				agent: "worker-1",
				checks: [{ command: "npm test", result: "1 failed", exit_code: 1 }],
			}),
		).rejects.toThrow(/requires verification evidence/);
		expect(harness.readBoardLog()).not.toContain("COMPLETE T-103");
	});

	it("accepts passing checks and persists them on the task", async () => {
		await seedTask("T-104");
		const result = await callTool(harness.tools, "kanban_complete", {
			task_id: "T-104",
			agent: "worker-1",
			duration: "30m",
			checks: [
				{ command: "npm test", result: "all passed", exit_code: 0 },
				{ command: "npm run check", result: "clean", exit_code: 0 },
			],
		});
		expect(result.isError).toBeFalsy();
		expect(result.details.checks).toHaveLength(2);
		expect(harness.readBoardLog()).toContain('checks=');

		const snapshot = await callTool(harness.tools, "kanban_snapshot", { task_id: "T-104" });
		const text = snapshot.content[0]?.text ?? "";
		expect(text).toContain("Verification evidence");
		expect(text).toContain("npm test");
		expect(text).toContain("all passed");
		expect(text).toContain("exit_code: 0");

		const json = await callTool(harness.tools, "kanban_export_json", {});
		const task = (json.details.tasks as Array<{ id: string; checks?: unknown[] }>).find((t) => t.id === "T-104");
		expect(task).toBeDefined();
		expect(task?.checks).toHaveLength(2);
	});
});
