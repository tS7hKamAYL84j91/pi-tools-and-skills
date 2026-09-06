import { existsSync } from "node:fs";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { TUI } from "@earendil-works/pi-tui";
import { join } from "node:path";
import { parseBoard } from "../../extensions/pi-kanban/board.js";
import { KanbanOverlay } from "../../extensions/pi-kanban/overlay.js";
import { callTool, setupKanbanToolHarness } from "./kanban-test-helpers.js";

const harness = setupKanbanToolHarness();

describe("kanban_snapshot", () => {
	it("returns a compact summary without writing a snapshot or board events", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-060",
			agent: "lead",
			title: "Snap me",
			priority: "high",
			description: "Detailed implementation notes stay out of model context",
		});
		await callTool(harness.tools, "kanban_edit", {
			task_id: "T-060",
			agent: "lead",
			note: "private-ish detail",
		});
		const before = harness.readBoardLog();
		const result = await callTool(harness.tools, "kanban_snapshot", {});

		expect(harness.readBoardLog()).toBe(before);
		expect(result.isError).toBeFalsy();
		expect(result.content[0]?.text).toContain("T-060");
		expect(result.content[0]?.text).toContain("Compact Summary");
		expect(result.content[0]?.text).toContain("View: compact");
		expect(result.content[0]?.text).not.toContain("private-ish detail");
		expect(existsSync(join(harness.tmpDir, "snapshot.md"))).toBe(false);

		const snap = result.content[0]?.text ?? "";
		expect(snap).toContain("T-060");
		expect(snap).toContain("Snap me");
		expect(snap).toContain("Compact Summary");
		expect(snap).not.toContain("private-ish detail");
	});

	it("returns full board details when explicitly requested", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-061",
			agent: "lead",
			title: "Full detail",
			priority: "medium",
			description: "Only include this in explicit full output",
		});
		await callTool(harness.tools, "kanban_edit", {
			task_id: "T-061",
			agent: "lead",
			note: "full board note",
		});

		const result = await callTool(harness.tools, "kanban_snapshot", { detail: "full" });

		expect(result.isError).toBeFalsy();
		expect(result.content[0]?.text).toContain("View: full");
		expect(result.content[0]?.text).toContain("Notes for T-061");
		expect(result.content[0]?.text).toContain(
			"Only include this in explicit full output",
		);
		expect(result.content[0]?.text).toContain("full board note");
	});

	it("returns one card's details when task_id is requested", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-062",
			agent: "lead",
			title: "Focused detail",
			priority: "critical",
			description: "Specific card context",
		});
		await callTool(harness.tools, "kanban_edit", {
			task_id: "T-062",
			agent: "lead",
			note: "specific note",
		});
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-063",
			agent: "lead",
			title: "Other card",
			priority: "low",
			description: "Should stay out of task-specific output",
		});

		const result = await callTool(harness.tools, "kanban_snapshot", {
			task_id: "T-062",
		});

		expect(result.isError).toBeFalsy();
		expect(result.content[0]?.text).toContain("View: task");
		expect(result.content[0]?.text).toContain("# Kanban Task T-062");
		expect(result.content[0]?.text).toContain("Specific card context");
		expect(result.content[0]?.text).toContain("specific note");
		expect(result.content[0]?.text).not.toContain("T-063");
		expect(result.content[0]?.text).not.toContain(
			"Should stay out of task-specific output",
		);
	});
});

describe("kanban_snapshot UX improvements", () => {
	it("includes blocked reason in compact summary", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-070",
			agent: "lead",
			title: "Blockable",
			priority: "high",
		});
		await callTool(harness.tools, "kanban_move", {
			task_id: "T-070",
			agent: "lead",
			to: "todo",
		});
		await callTool(harness.tools, "kanban_claim", {
			task_id: "T-070",
			agent: "worker-1",
		});
		await callTool(harness.tools, "kanban_block", {
			task_id: "T-070",
			agent: "worker-1",
			reason: "waiting on API key",
		});

		const result = await callTool(harness.tools, "kanban_snapshot", {});
		expect(result.isError).toBeFalsy();
		// Blocked tasks should show the reason in the compact summary
		expect(result.content[0]?.text).toContain("waiting on API key");
	});

	it("shows plain count when all done tasks fit in summary", async () => {
		// Create 3 done tasks and verify the compact summary shows "3" not "last 3 of 3"
		for (let i = 0; i < 3; i++) {
			const id = `T-08${i}`;
			await callTool(harness.tools, "kanban_create", {
				task_id: id,
				agent: "lead",
				title: `Done task ${i}`,
				priority: "low",
			});
			await callTool(harness.tools, "kanban_move", {
				task_id: id,
				agent: "lead",
				to: "todo",
			});
			await callTool(harness.tools, "kanban_claim", {
				task_id: id,
				agent: `worker-${i}`,
			});
			await callTool(harness.tools, "kanban_complete", {
				task_id: id,
				agent: `worker-${i}`,
				duration: "1h",
			});
		}

		const result = await callTool(harness.tools, "kanban_snapshot", {});
		expect(result.isError).toBeFalsy();
		// Should show "(3)" not "(last 3 of 3)"
		expect(result.content[0]?.text).toMatch(/Done \(3\)/);
		expect(result.content[0]?.text).not.toContain("last 3 of 3");
	});

	it("shows last N of M when done tasks exceed summary limit", async () => {
		// Create 6 done tasks (more than the 5-item summary limit)
		for (let i = 0; i < 6; i++) {
			const id = `T-09${i}`;
			await callTool(harness.tools, "kanban_create", {
				task_id: id,
				agent: "lead",
				title: `Done task ${i}`,
				priority: "low",
			});
			await callTool(harness.tools, "kanban_move", {
				task_id: id,
				agent: "lead",
				to: "todo",
			});
			await callTool(harness.tools, "kanban_claim", {
				task_id: id,
				agent: `worker-${i}`,
			});
			await callTool(harness.tools, "kanban_complete", {
				task_id: id,
				agent: `worker-${i}`,
				duration: "1h",
			});
		}

		const result = await callTool(harness.tools, "kanban_snapshot", {});
		expect(result.isError).toBeFalsy();
		// Should show "last 5 of 6" in the compact summary
		expect(result.content[0]?.text).toContain("last 5 of 6");
	});

	it("shows plain count in full snapshot when done tasks fit within 10", async () => {
		for (let i = 0; i < 3; i++) {
			const id = `T-10${i}`;
			await callTool(harness.tools, "kanban_create", {
				task_id: id,
				agent: "lead",
				title: `Done full ${i}`,
				priority: "low",
			});
			await callTool(harness.tools, "kanban_move", {
				task_id: id,
				agent: "lead",
				to: "todo",
			});
			await callTool(harness.tools, "kanban_claim", {
				task_id: id,
				agent: `worker-${i}`,
			});
			await callTool(harness.tools, "kanban_complete", {
				task_id: id,
				agent: `worker-${i}`,
				duration: "1h",
			});
		}

		const result = await callTool(harness.tools, "kanban_snapshot", { detail: "full" });
		expect(result.isError).toBeFalsy();
		const snap = result.content[0]?.text ?? "";
		// Should show "(3)" not "(last 10 of 3)"
		expect(snap).toMatch(/Done \(3\)/);
		expect(snap).not.toContain("last 10 of 3");
	});
});

describe("overlay guard logic", () => {
	// These tests verify the guard behavior indirectly through the overlay controller.
	// The overlay.ts module uses internal class state; we test snapshot/render functions instead.
	// Guard logic is: move-picker only for backlog/todo, delete for every column except in-progress.

	it("delete rejects in-progress task", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-120",
			agent: "lead",
			title: "IP delete",
			priority: "high",
		});
		await callTool(harness.tools, "kanban_move", {
			task_id: "T-120",
			agent: "lead",
			to: "todo",
		});
		await callTool(harness.tools, "kanban_claim", {
			task_id: "T-120",
			agent: "worker-1",
		});

		await expect(
			callTool(harness.tools, "kanban_delete", { task_id: "T-120", agent: "lead" }),
		).rejects.toThrow(/Cannot delete task T-120.*in-progress/);
	});

	it("deletes a blocked task and preserves DELETE audit/replay", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-121",
			agent: "lead",
			title: "Blocked delete",
			priority: "high",
		});
		await callTool(harness.tools, "kanban_move", {
			task_id: "T-121",
			agent: "lead",
			to: "todo",
		});
		await callTool(harness.tools, "kanban_claim", {
			task_id: "T-121",
			agent: "worker-1",
		});
		await callTool(harness.tools, "kanban_block", {
			task_id: "T-121",
			agent: "worker-1",
			reason: "stuck",
		});

		const result = await callTool(harness.tools, "kanban_delete", {
			task_id: "T-121",
			agent: "lead",
			reason: "stale blocker",
		});
		expect(result.isError).toBeFalsy();
		expect(result.details.previousCol).toBe("blocked");
		expect(harness.readBoardLog()).toMatch(/DELETE T-121 lead reason="stale blocker"/);

		const view = await callTool(harness.tools, "kanban_snapshot", { detail: "full" });
		expect(view.content[0]?.text).not.toContain("T-121");
	});

	it("confirmed blocked deletion runs through the TUI controller", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-124",
			agent: "lead",
			title: "Controller blocked delete",
			priority: "high",
		});
		await callTool(harness.tools, "kanban_move", {
			task_id: "T-124",
			agent: "lead",
			to: "todo",
		});
		await callTool(harness.tools, "kanban_claim", {
			task_id: "T-124",
			agent: "worker-1",
		});
		await callTool(harness.tools, "kanban_block", {
			task_id: "T-124",
			agent: "worker-1",
			reason: "stuck",
		});

		const overlay = new KanbanOverlay(
			{ requestRender: () => undefined } as unknown as TUI,
			{
				fg: (_color: string, text: string) => text,
				bold: (text: string) => text,
			} as unknown as Theme,
			await parseBoard(),
			() => undefined,
		);
		overlay.handleInput("\x1b[C");
		overlay.handleInput("d");
		expect(overlay.render(80).join("\n")).toContain("Delete Task?");
		overlay.handleInput("n");
		expect(harness.readBoardLog()).not.toContain("DELETE T-124");
		overlay.handleInput("d");
		overlay.handleInput("y");
		await new Promise((resolve) => setTimeout(resolve, 50));
		overlay.dispose();

		expect(harness.readBoardLog()).toMatch(/DELETE T-124 lead/);
	});

	it("delete allows backlog task", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-122",
			agent: "lead",
			title: "Backlog delete",
			priority: "low",
		});
		const result = await callTool(harness.tools, "kanban_delete", {
			task_id: "T-122",
			agent: "lead",
		});
		expect(result.isError).toBeFalsy();
		expect(result.details.task_id).toBe("T-122");
	});

	it("move rejects in-progress task", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-123",
			agent: "lead",
			title: "IP move",
			priority: "high",
		});
		await callTool(harness.tools, "kanban_move", {
			task_id: "T-123",
			agent: "lead",
			to: "todo",
		});
		await callTool(harness.tools, "kanban_claim", {
			task_id: "T-123",
			agent: "worker-1",
		});

		await expect(
			callTool(harness.tools, "kanban_move", {
				task_id: "T-123",
				agent: "lead",
				to: "backlog",
			}),
		).rejects.toThrow(/Cannot move task T-123 from 'in-progress'/);
	});
});
