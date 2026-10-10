import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { parseBoard } from "../../extensions/pi-kanban/board.js";
import { KanbanOverlay } from "../../extensions/pi-kanban/overlay.js";
import { callTool, setupKanbanToolHarness } from "./kanban-test-helpers.js";

const harness = setupKanbanToolHarness();
async function create(id: string, claimed = false) {
	await callTool(harness.tools, "kanban_create", { task_id: id, agent: "lead", title: "Guarded task", priority: "high" });
	if (claimed) {
		await callTool(harness.tools, "kanban_move", { task_id: id, agent: "lead", to: "todo" });
		await callTool(harness.tools, "kanban_claim", { task_id: id, agent: "worker-1" });
	}
}
describe("overlay and board guard logic", () => {
	it("rejects in-progress deletion and move", async () => {
		await create("T-120", true);
		await expect(callTool(harness.tools, "kanban_delete", { task_id: "T-120", agent: "lead" })).rejects.toThrow(/Cannot delete.*in-progress/);
		await expect(callTool(harness.tools, "kanban_move", { task_id: "T-120", agent: "lead", to: "backlog" })).rejects.toThrow(/Cannot move.*in-progress/);
	});
	it("deletes a blocked task with replayable audit and hides it from JSON export", async () => {
		await create("T-121", true);
		await callTool(harness.tools, "kanban_block", { task_id: "T-121", agent: "worker-1", reason: "waiting on API key" });
		const before = await callTool(harness.tools, "kanban_export_json", {});
		expect(before.content[0]?.text).toContain("waiting on API key");
		const result = await callTool(harness.tools, "kanban_delete", { task_id: "T-121", agent: "lead", reason: "stale blocker" });
		expect(result.details.previousCol).toBe("blocked");
		expect(harness.readEvents()).toContainEqual(
			expect.objectContaining({ type: "delete", task_id: "T-121", agent: "lead", reason: "stale blocker" }),
		);
		expect((await callTool(harness.tools, "kanban_export_json", {})).content[0]?.text).not.toContain("T-121");
	});
	it("confirmed blocked deletion runs through the TUI controller; cancellation does not delete", async () => {
		await create("T-124", true);
		await callTool(harness.tools, "kanban_block", { task_id: "T-124", agent: "worker-1", reason: "stuck" });
		const overlay = new KanbanOverlay({ requestRender: () => undefined } as unknown as TUI,
			{ fg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme,
			await parseBoard(), () => undefined, { agent: "lead" });
		try {
			overlay.handleInput("\x1b[C");
			overlay.handleInput("d");
			expect(overlay.render(80).join("\n")).toContain("Delete Task?");
			overlay.handleInput("n");
			expect(harness.readEvents().some((e) => e.type === "delete" && e.task_id === "T-124")).toBe(false);
			overlay.handleInput("d");
			overlay.handleInput("y");
			await new Promise(resolve => setTimeout(resolve, 50));
			expect(harness.readEvents()).toContainEqual(
				expect.objectContaining({ type: "delete", task_id: "T-124", agent: "lead" }),
			);
		} finally { overlay.dispose(); }
	});
	it("allows backlog deletion", async () => {
		await create("T-122");
		expect((await callTool(harness.tools, "kanban_delete", { task_id: "T-122", agent: "lead" })).details.task_id).toBe("T-122");
	});
});
