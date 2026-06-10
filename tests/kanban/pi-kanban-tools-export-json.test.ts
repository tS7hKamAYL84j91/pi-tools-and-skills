import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { callTool, setupKanbanToolHarness } from "./kanban-test-helpers.js";

const harness = setupKanbanToolHarness();

describe("kanban_export_json", () => {
	it("exports active tasks and counts without mutating board state", async () => {
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-101",
			agent: "lead",
			title: "Export me",
			priority: "high",
			description: "private implementation note",
			tags: "api, docs",
		});
		await callTool(harness.tools, "kanban_create", {
			task_id: "T-102",
			agent: "lead",
			title: "Skip deleted",
			priority: "low",
		});
		await callTool(harness.tools, "kanban_move", { task_id: "T-101", agent: "lead", to: "todo" });
		await callTool(harness.tools, "kanban_delete", { task_id: "T-102", agent: "lead", reason: "test cleanup" });
		const before = harness.readBoardLog();

		const result = await callTool(harness.tools, "kanban_export_json", {});
		const exported = JSON.parse(result.content[0]?.text ?? "{}");

		expect(result.isError).toBeFalsy();
		expect(exported).toEqual({
			schemaVersion: 1,
			totalEvents: 4,
			counts: { todo: 1 },
			tasks: [expect.objectContaining({ id: "T-101", column: "todo", priority: "high", title: "Export me", tags: ["api", "docs"] })],
		});
		expect(result.details).toEqual(exported);
		expect(result.content[0]?.text).not.toContain("private implementation note");
		expect(harness.readBoardLog()).toBe(before);
		expect(existsSync(join(harness.tmpDir, "snapshot.md"))).toBe(false);
	});
});
