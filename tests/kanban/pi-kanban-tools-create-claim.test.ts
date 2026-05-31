import { describe, expect, it, beforeEach } from "vitest";
import { WIP_LIMIT } from "../../extensions/pi-kanban/board.js";
import { callTool, setupKanbanToolHarness } from "./kanban-test-helpers.js";

const harness = setupKanbanToolHarness();

describe("kanban_create", () => {
	it("creates a task in backlog and writes log + task file", async () => {
		const result = await callTool(harness.tools, "kanban_create", {
			task_id: "T-001",
			agent: "lead",
			title: "Build the thing",
			priority: "high",
			tags: "core,infra",
			description: "A task that builds the thing",
		});

		expect(result.isError).toBeFalsy();
		expect(result.content[0]?.text).toContain("Created T-001");
		expect(result.details.task_id).toBe("T-001");

		const log = harness.readBoardLog();
		expect(log).toContain("CREATE T-001 lead");
		expect(log).toContain('title="Build the thing"');
		expect(log).toContain('priority="high"');

		const taskFile = harness.readTaskFile("T-001");
		expect(taskFile).toContain('title: "Build the thing"');
		expect(taskFile).toContain("priority: high");
		expect(taskFile).toContain("A task that builds the thing");
	});

	it("rejects duplicate task IDs", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-002",
			agent: "lead",
			title: "First",
			priority: "low",
		});
		await expect(
			callTool(harness.tools, "kanban_create", {
				task_id: "T-002",
				agent: "lead",
				title: "Second",
				priority: "low",
			}),
		).rejects.toThrow(/already exists/);
	});

	it("rejects malformed task IDs", async () => {
		await expect(
			callTool(harness.tools, "kanban_create", {
				task_id: "bogus",
				agent: "lead",
				title: "x",
				priority: "low",
			}),
		).rejects.toThrow(/T-NNN/);
	});

	it("keeps untagged tickets backward compatible", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-003",
			agent: "lead",
			title: "Untagged",
			priority: "medium",
		});

		const detail = await callTool(harness.tools, "kanban_snapshot", { task_id: "T-003" });
		expect(detail.content[0]?.text).toContain("- Tags: —");

		const taskFile = harness.readTaskFile("T-003");
		expect(taskFile).toContain("tags: []");
	});

	it("preserves a single feature tag in snapshots and task files", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-004",
			agent: "lead",
			title: "Feature tagged",
			priority: "high",
			tags: "feature:research-tools",
		});

		const detail = await callTool(harness.tools, "kanban_snapshot", { task_id: "T-004" });
		expect(detail.content[0]?.text).toContain("- Tags: feature:research-tools");

		const taskFile = harness.readTaskFile("T-004");
		expect(taskFile).toContain("tags: [feature:research-tools]");
	});

	it("preserves multiple feature, epic, and generic tags", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-005",
			agent: "lead",
			title: "Multi tagged",
			priority: "low",
			tags: "feature:kanban-metadata,epic:operator-followthrough,docs",
		});

		const snapshot = await callTool(harness.tools, "kanban_snapshot", { detail: "full" });
		expect(snapshot.content[0]?.text).toContain("feature:kanban-metadata,epic:operator-followthrough,docs");

		const taskFile = harness.readTaskFile("T-005");
		expect(taskFile).toContain("tags: [feature:kanban-metadata, epic:operator-followthrough, docs]");
	});

	it("preserves unknown tag values as generic metadata", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-006",
			agent: "lead",
			title: "Generic tagged",
			priority: "medium",
			tags: "customer-x,theme.alpha",
		});

		const detail = await callTool(harness.tools, "kanban_snapshot", { task_id: "T-006" });
		expect(detail.content[0]?.text).toContain("- Tags: customer-x,theme.alpha");
	});
});

describe("kanban_claim", () => {
	beforeEach(async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-010",
			agent: "lead",
			title: "Claimable",
			priority: "high",
		});
		// CREATE puts task in backlog; move it to todo so claim can pick it up
		await callTool(harness.tools, "kanban_move", {
			task_id: "T-010",
			agent: "lead",
			to: "todo",
		});
	});

	it("claims a todo task and moves it to in-progress", async () => {
		const result = await callTool(harness.tools, "kanban_claim", {
			task_id: "T-010",
			agent: "worker-1",
		});

		expect(result.isError).toBeFalsy();
		expect(result.details.result).toBe("CLAIMED");
		expect(result.details.claimed).toBe(true);

		const log = harness.readBoardLog();
		expect(log).toContain("CLAIM T-010 worker-1");
		expect(log).toContain("MOVE T-010 worker-1 from=todo to=in-progress");
	});

	it("returns TASK_NOT_FOUND for unknown task", async () => {
		const result = await callTool(harness.tools, "kanban_claim", {
			task_id: "T-999",
			agent: "worker-1",
		});
		expect(result.details.result).toBe("TASK_NOT_FOUND");
		expect(result.details.claimed).toBe(false);
	});

	it("reassigns an in-progress task to a new agent", async () => {
		await callTool(harness.tools, "kanban_claim", {
			task_id: "T-010",
			agent: "worker-1",
		});

		const result = await callTool(harness.tools, "kanban_claim", {
			task_id: "T-010",
			agent: "worker-2",
		});

		expect(result.isError).toBeFalsy();
		expect(result.details.task_id).toBe("T-010");
		expect(result.details.oldAgent).toBe("worker-1");
		expect(result.details.newAgent).toBe("worker-2");

		const log = harness.readBoardLog();
		expect(log).toContain("UNCLAIM T-010 worker-1");
		expect(log).toContain("CLAIM T-010 worker-2");
	});

	it("returns WRONG_COLUMN if task not in todo", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-011",
			agent: "lead",
			title: "Backlog item",
			priority: "low",
		});
		// Still in backlog
		const result = await callTool(harness.tools, "kanban_claim", {
			task_id: "T-011",
			agent: "worker-1",
		});
		expect(result.details.result).toBe("WRONG_COLUMN");
		expect(result.details.col).toBe("backlog");
	});

	it("returns WIP_LIMIT_REACHED when WIP cap is hit", async () => {
		// Fill WIP up to the limit using fresh tasks
		for (let i = 0; i < WIP_LIMIT; i++) {
			const id = `T-${String(20 + i).padStart(3, "0")}`;
			await callTool(harness.tools, "kanban_create", {
				task_id: id,
				agent: "lead",
				title: id,
				priority: "medium",
			});
			await callTool(harness.tools, "kanban_move", {
				task_id: id,
				agent: "lead",
				to: "todo",
			});
			const c = await callTool(harness.tools, "kanban_claim", {
				task_id: id,
				agent: `worker${id.slice(2)}`,
			});
			expect(c.details.result, `claim ${id}: ${c.content[0]?.text}`).toBe(
				"CLAIMED",
			);
		}
		// T-010 (already in todo from outer beforeEach) should now hit the cap
		const result = await callTool(harness.tools, "kanban_claim", {
			task_id: "T-010",
			agent: "worker-extra",
		});
		expect(result.details.result, result.content[0]?.text).toBe(
			"WIP_LIMIT_REACHED",
		);
	});
});

describe("kanban_complete", () => {
	beforeEach(async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-030",
			agent: "lead",
			title: "To finish",
			priority: "high",
		});
		await callTool(harness.tools, "kanban_move", {
			task_id: "T-030",
			agent: "lead",
			to: "todo",
		});
		await callTool(harness.tools, "kanban_claim", {
			task_id: "T-030",
			agent: "worker-1",
		});
	});

	it("completes an in-progress task and moves it to done", async () => {
		const result = await callTool(harness.tools, "kanban_complete", {
			task_id: "T-030",
			agent: "worker-1",
			duration: "45m",
		});
		expect(result.isError).toBeFalsy();
		expect(result.details.task_id).toBe("T-030");
		expect(result.details.duration).toBe("45m");

		const log = harness.readBoardLog();
		expect(log).toContain("COMPLETE T-030 worker-1 duration=45m");
		expect(log).toContain("MOVE T-030 worker-1 from=in-progress to=done");
	});

	it("rejects completing a task not in in-progress", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-031",
			agent: "lead",
			title: "x",
			priority: "low",
		});
		await expect(
			callTool(harness.tools, "kanban_complete", {
				task_id: "T-031",
				agent: "lead",
				duration: "1m",
			}),
		).rejects.toThrow(/not in-progress/);
	});

	it("defaults duration to 'unknown' when omitted", async () => {
		const result = await callTool(harness.tools, "kanban_complete", {
			task_id: "T-030",
			agent: "worker-1",
		});
		expect(result.details.duration).toBe("unknown");
	});
});
