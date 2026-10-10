import { describe, expect, it, beforeEach } from "vitest";
import { callTool, setupKanbanToolHarness } from "./kanban-test-helpers.js";

const harness = setupKanbanToolHarness();

describe("scheduler-safe kanban surface", () => {
	it("supports structured read, one-task claim, progress note, and guarded repeat claim", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-043",
			agent: "lead",
			title: "Scheduled pickup",
			priority: "high",
		});
		await callTool(harness.tools, "kanban_move", {
			task_id: "T-043",
			agent: "lead",
			to: "todo",
		});

		const exported = await callTool(harness.tools, "kanban_export_json", {});
		expect(exported.isError).toBeFalsy();
		expect(exported.content[0]?.text).toContain("T-043");

		const claim = await callTool(harness.tools, "kanban_claim", { agent: "automations-scheduler" });
		expect(claim.details).toMatchObject({ result: "CLAIMED", claimed: true, task_id: "T-043" });

		const note = await callTool(harness.tools, "kanban_edit", {
			task_id: "T-043",
			agent: "automations-scheduler",
			note: "scheduled pickup started",
		});
		expect(note.details.changed).toEqual({ note: "scheduled pickup started" });

		const repeatPick = await callTool(harness.tools, "kanban_claim", {
			agent: "automations-scheduler",
		});
		expect(repeatPick.details).toMatchObject({ result: "NO_TASK_AVAILABLE", claimed: false });
	});
});

describe("kanban_claim without task_id", () => {
	it("picks the highest-priority todo task", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-040",
			agent: "lead",
			title: "low",
			priority: "low",
		});
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-041",
			agent: "lead",
			title: "critical",
			priority: "critical",
		});
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-042",
			agent: "lead",
			title: "medium",
			priority: "medium",
		});
		for (const id of ["T-040", "T-041", "T-042"]) {
			await callTool(harness.tools, "kanban_move", {
				task_id: id,
				agent: "lead",
				to: "todo",
			});
		}

		const result = await callTool(harness.tools, "kanban_claim", { agent: "worker-1" });
		expect(result.details.result).toBe("CLAIMED");
		expect(result.details.task_id).toBe("T-041");
		expect(result.details.claimed).toBe(true);
	});

	it("uses the lowest task ID as the priority tie-breaker", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-045",
			agent: "lead",
			title: "later",
			priority: "high",
		});
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-044",
			agent: "lead",
			title: "earlier",
			priority: "high",
		});
		for (const id of ["T-045", "T-044"]) {
			await callTool(harness.tools, "kanban_move", {
				task_id: id,
				agent: "lead",
				to: "todo",
			});
		}

		const result = await callTool(harness.tools, "kanban_claim", { agent: "worker-1" });

		expect(result.details.result).toBe("CLAIMED");
		expect(result.details.task_id).toBe("T-044");
	});

	it("returns NO_TASK_AVAILABLE when nothing in todo", async () => {
		const result = await callTool(harness.tools, "kanban_claim", { agent: "worker-1" });
		expect(result.details.result).toBe("NO_TASK_AVAILABLE");
	});
});

describe("kanban_edit note + kanban_block", () => {
	beforeEach(async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-050",
			agent: "lead",
			title: "Notable",
			priority: "medium",
		});
		await callTool(harness.tools, "kanban_move", {
			task_id: "T-050",
			agent: "lead",
			to: "todo",
		});
		await callTool(harness.tools, "kanban_claim", {
			task_id: "T-050",
			agent: "worker-1",
		});
	});

	it("appends a note to the log and the task file", async () => {
		const result = await callTool(harness.tools, "kanban_edit", {
			task_id: "T-050",
			agent: "worker-1",
			note: "halfway done",
		});
		expect(result.isError).toBeFalsy();
		expect(result.details.changed).toEqual({ note: "halfway done" });

		expect(harness.readEvents()).toContainEqual(
			expect.objectContaining({ type: "note", task_id: "T-050", agent: "worker-1", text: "halfway done" }),
		);

		const taskFile = harness.readTaskFile("T-050");
		expect(taskFile).toContain("halfway done");
	});

	it("blocks an in-progress task", async () => {
		const result = await callTool(harness.tools, "kanban_block", {
			task_id: "T-050",
			agent: "worker-1",
			reason: "waiting on API key",
		});
		expect(result.isError).toBeFalsy();

		expect(harness.readEvents()).toContainEqual(
			expect.objectContaining({ type: "block", task_id: "T-050", agent: "worker-1", reason: "waiting on API key" }),
		);
		expect(harness.readEvents()).toContainEqual(
			expect.objectContaining({ type: "move", task_id: "T-050", agent: "worker-1", from: "in-progress", to: "blocked" }),
		);
	});

	it("round-trips embedded quotes in notes through the JSONL log", async () => {
		// JSONL encodes values, so embedded `"` need no escaping and the next
		// board read always round-trips.
		await callTool(harness.tools, "kanban_edit", {
			task_id: "T-050",
			agent: "worker-1",
			note: 'use "quotes" carefully',
		});

		expect(harness.readEvents()).toContainEqual(
			expect.objectContaining({ type: "note", task_id: "T-050", text: 'use "quotes" carefully' }),
		);

		// Structured export must still retain the task after the embedded quote.
		const snap = await callTool(harness.tools, "kanban_export_json", {});
		expect(snap.isError).toBeFalsy();
		expect(snap.content[0]?.text).toContain("T-050");
		expect(snap.content[0]?.text).toContain("Notable");
	});
});

describe("kanban_edit metadata error message", () => {
	it("shows improved error message when editing in-progress task metadata", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-110",
			agent: "lead",
			title: "IP task",
			priority: "high",
		});
		await callTool(harness.tools, "kanban_move", {
			task_id: "T-110",
			agent: "lead",
			to: "todo",
		});
		await callTool(harness.tools, "kanban_claim", {
			task_id: "T-110",
			agent: "worker-1",
		});

		await expect(
			callTool(harness.tools, "kanban_edit", {
				task_id: "T-110",
				agent: "worker-1",
				title: "New title",
			}),
		).rejects.toThrow(/Metadata edits.*only allowed.*backlog or todo/);
	});

	it("allows notes on in-progress tasks", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-111",
			agent: "lead",
			title: "IP task 2",
			priority: "high",
		});
		await callTool(harness.tools, "kanban_move", {
			task_id: "T-111",
			agent: "lead",
			to: "todo",
		});
		await callTool(harness.tools, "kanban_claim", {
			task_id: "T-111",
			agent: "worker-1",
		});

		const result = await callTool(harness.tools, "kanban_edit", {
			task_id: "T-111",
			agent: "worker-1",
			note: "progress update",
		});
		expect(result.isError).toBeFalsy();
		expect(result.details.changed).toEqual({ note: "progress update" });
	});
});
