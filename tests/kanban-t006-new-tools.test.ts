/**
 * TDD tests for T-006: Add kanban_unblock and kanban_move tools
 *
 * Tools to add:
 * 1. kanban_unblock: unblock a task, move from blocked to todo
 * 2. kanban_move: move a task between backlog/todo columns
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanupDir, makeTmpKanbanDir, seedLog } from "./helpers.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

describe("kanban_unblock & kanban_move (T-006)", () => {
	let tmpDir: string;
	let savedKanbanDir: string | undefined;

	beforeEach(async () => {
		savedKanbanDir = process.env.KANBAN_DIR;
		tmpDir = await makeTmpKanbanDir();
		process.env.KANBAN_DIR = tmpDir;
	});

	afterEach(async () => {
		if (savedKanbanDir === undefined) {
			delete process.env.KANBAN_DIR;
		} else {
			process.env.KANBAN_DIR = savedKanbanDir;
		}
		await cleanupDir(tmpDir);
		vi.resetModules();
	});

	it("Test 1: kanban_unblock on a blocked task → success, logs UNBLOCK+MOVE", async () => {
		// Seed a blocked task
		await seedLog(tmpDir, [
			"2026-03-31T12:00:00Z CREATE T-5 agent1 title=\"Blocked Task\" priority=high tags=",
			"2026-03-31T12:00:00Z MOVE T-5 agent1 from=created to=in-progress",
			"2026-03-31T12:00:00Z BLOCK T-5 agent1 reason=\"waiting for API key\"",
			"2026-03-31T12:00:00Z MOVE T-5 agent1 from=in-progress to=blocked",
		]);

		vi.resetModules();
		const kanbanModule = await import("../extensions/kanban.ts");
		const kanban = kanbanModule.default as (pi: ExtensionAPI) => void;

		// Mock ExtensionAPI
		const tools = new Map();
		const mockPi = {
			registerTool: (t: any) => tools.set(t.name, t),
			registerFlag: () => {},
			getFlag: () => false,
		} as unknown as ExtensionAPI;

		kanban(mockPi);

		// Get kanban_unblock tool
		const unblockTool = tools.get("kanban_unblock");
		expect(unblockTool).toBeDefined();

		// Execute unblock
		const result = await unblockTool.execute("tool-call-id", {
			task_id: "T-5",
			agent: "agent1",
			reason: "API key received",
		}, null);

		// Check result text
		expect(result.content[0].text).toContain("Unblocked T-5");
		expect(result.content[0].text).toContain("moved to todo");

		// Check board.log has UNBLOCK and MOVE events
		const logContent = await readFile(join(tmpDir, "board.log"), "utf-8");
		const lines = logContent.split("\n").filter(l => l.trim());

		const unblockLine = lines.find(l => l.includes("UNBLOCK T-5"));
		expect(unblockLine).toBeDefined();
		expect(unblockLine).toContain("agent1");
		expect(unblockLine).toContain("resolution=");

		const moveLine = lines.find(l => l.includes("MOVE T-5") && l.includes("from=blocked") && l.includes("to=todo"));
		expect(moveLine).toBeDefined();
	});

	it("Test 2: kanban_unblock on non-blocked task → throws error", async () => {
		// Seed a task that's NOT blocked
		await seedLog(tmpDir, [
			"2026-03-31T12:00:00Z CREATE T-6 agent1 title=\"Todo Task\" priority=high tags=",
			"2026-03-31T12:00:00Z MOVE T-6 agent1 from=created to=todo",
		]);

		vi.resetModules();
		const kanbanModule = await import("../extensions/kanban.ts");
		const kanban = kanbanModule.default as (pi: ExtensionAPI) => void;

		const tools = new Map();
		const mockPi = {
			registerTool: (t: any) => tools.set(t.name, t),
			registerFlag: () => {},
			getFlag: () => false,
		} as unknown as ExtensionAPI;

		kanban(mockPi);

		const unblockTool = tools.get("kanban_unblock");
		expect(unblockTool).toBeDefined();

		// Should throw because T-6 is in 'todo' column, not 'blocked'
		await expect(
			unblockTool.execute("tool-call-id", {
				task_id: "T-6",
				agent: "agent1",
				reason: "no longer blocked",
			}, null),
		).rejects.toThrow();
	});

	it("Test 3: kanban_move from backlog to todo → success, logs MOVE event", async () => {
		// Seed a task in backlog
		await seedLog(tmpDir, [
			"2026-03-31T12:00:00Z CREATE T-10 agent1 title=\"Backlog Task\" priority=high tags=",
			"2026-03-31T12:00:00Z MOVE T-10 agent1 from=created to=backlog",
		]);

		vi.resetModules();
		const kanbanModule = await import("../extensions/kanban.ts");
		const kanban = kanbanModule.default as (pi: ExtensionAPI) => void;

		const tools = new Map();
		const mockPi = {
			registerTool: (t: any) => tools.set(t.name, t),
			registerFlag: () => {},
			getFlag: () => false,
		} as unknown as ExtensionAPI;

		kanban(mockPi);

		const moveTool = tools.get("kanban_move");
		expect(moveTool).toBeDefined();

		// Move from backlog to todo
		const result = await moveTool.execute("tool-call-id", {
			task_id: "T-10",
			agent: "agent1",
			to: "todo",
		}, null);

		// Check result text
		expect(result.content[0].text).toContain("Moved T-10");
		expect(result.content[0].text).toContain("from backlog");
		expect(result.content[0].text).toContain("to todo");

		// Check board.log has MOVE event
		const logContent = await readFile(join(tmpDir, "board.log"), "utf-8");
		const lines = logContent.split("\n").filter(l => l.trim());

		const moveLine = lines.find(l => l.includes("MOVE T-10") && l.includes("from=backlog") && l.includes("to=todo"));
		expect(moveLine).toBeDefined();
	});

	it("Test 4: kanban_move on in-progress task → throws error", async () => {
		// Seed a task that's in-progress
		await seedLog(tmpDir, [
			"2026-03-31T12:00:00Z CREATE T-15 agent1 title=\"In Progress\" priority=high tags=",
			"2026-03-31T12:00:00Z MOVE T-15 agent1 from=created to=in-progress",
		]);

		vi.resetModules();
		const kanbanModule = await import("../extensions/kanban.ts");
		const kanban = kanbanModule.default as (pi: ExtensionAPI) => void;

		const tools = new Map();
		const mockPi = {
			registerTool: (t: any) => tools.set(t.name, t),
			registerFlag: () => {},
			getFlag: () => false,
		} as unknown as ExtensionAPI;

		kanban(mockPi);

		const moveTool = tools.get("kanban_move");
		expect(moveTool).toBeDefined();

		// Should throw because T-15 is in-progress
		await expect(
			moveTool.execute("tool-call-id", {
				task_id: "T-15",
				agent: "agent1",
				to: "todo",
			}, null),
		).rejects.toThrow();
	});
});
