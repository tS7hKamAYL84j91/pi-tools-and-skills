/**
 * TDD tests for T-003: Fix bugs in kanban_create
 *
 * Bugs to fix:
 * 1. Unquoted tags/priority in log — should quote both
 * 2. No duplicate ID check — should throw if task_id already exists
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanupDir, makeTmpKanbanDir, seedLog } from "./helpers.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

describe("kanban_create (T-003)", () => {
	let tmpDir: string;
	let savedKanbanDir: string | undefined;

	beforeEach(async () => {
		// Save original env vars
		savedKanbanDir = process.env.KANBAN_DIR;

		// Create temp kanban dir
		tmpDir = await makeTmpKanbanDir();
		process.env.KANBAN_DIR = tmpDir;
	});

	afterEach(async () => {
		// Restore env vars
		if (savedKanbanDir === undefined) {
			delete process.env.KANBAN_DIR;
		} else {
			process.env.KANBAN_DIR = savedKanbanDir;
		}

		// Cleanup temp dir
		await cleanupDir(tmpDir);

		// Reset modules to clear any cached env vars
		vi.resetModules();
	});

	it("Test 1: tags with spaces are stored quoted in log", async () => {
		// Start with empty board
		await seedLog(tmpDir, []);

		// Reset modules to ensure fresh import with correct KANBAN_DIR
		vi.resetModules();

		// Dynamically import the module with fresh env
		const kanbanModule = await import("../extensions/kanban.ts");
		const kanban = kanbanModule.default as (pi: ExtensionAPI) => void;

		// Mock ExtensionAPI
		const mockPi = {
			registerTool: vi.fn(),
			registerFlag: vi.fn(),
			getFlag: vi.fn(),
		} as unknown as ExtensionAPI;

		// Call the extension to register tools
		kanban(mockPi);

		// Get the kanban_create tool
		const callsToRegisterTool = (mockPi.registerTool as any).mock.calls;
		const createToolCall = callsToRegisterTool.find(
			( call: any[]) => call[0]?.name === "kanban_create",
		);
		expect(createToolCall).toBeDefined();

		const createTool = createToolCall[0];

		// Call kanban_create with tags containing spaces
		const result = await createTool.execute("tool-call-id", {
			task_id: "T-001",
			agent: "test-agent",
			title: "Test Task",
			priority: "high",
			tags: "bug fix urgent",
		}, null);

		expect(result.content[0].text).toContain("Created T-001");

		// Read the log file and verify tags and priority are quoted
		const logContent = await readFile(join(tmpDir, "board.log"), "utf-8");
		const lines = logContent.trim().split("\n");

		// Find the CREATE line
		const createLine = lines.find((l) => l.includes("CREATE T-001"));
		expect(createLine).toBeDefined();
		expect(createLine).toContain('priority="high"');
		expect(createLine).toContain('tags="bug fix urgent"');
	});

	it("Test 2: creating duplicate task ID throws 'already exists'", async () => {
		// Seed a task that already exists
		await seedLog(tmpDir, [
			"2026-03-31T12:00:00Z CREATE T-001 agent1 title=\"Existing Task\" priority=\"high\" tags=\"\"",
			"2026-03-31T12:00:00Z MOVE T-001 agent1 from=created to=backlog",
		]);

		// Reset modules to ensure fresh import with correct KANBAN_DIR
		vi.resetModules();

		// Dynamically import the module with fresh env
		const kanbanModule = await import("../extensions/kanban.ts");
		const kanban = kanbanModule.default as (pi: ExtensionAPI) => void;

		// Mock ExtensionAPI
		const mockPi = {
			registerTool: vi.fn(),
			registerFlag: vi.fn(),
			getFlag: vi.fn(),
		} as unknown as ExtensionAPI;

		// Call the extension to register tools
		kanban(mockPi);

		// Get the kanban_create tool
		const callsToRegisterTool = (mockPi.registerTool as any).mock.calls;
		const createToolCall = callsToRegisterTool.find(
			( call: any[]) => call[0]?.name === "kanban_create",
		);
		expect(createToolCall).toBeDefined();

		const createTool = createToolCall[0];

		// Try to create a task with an ID that already exists
		await expect(
			createTool.execute("tool-call-id", {
				task_id: "T-001",
				agent: "test-agent",
				title: "Duplicate Task",
				priority: "medium",
				tags: "duplicate",
			}, null)
		).rejects.toThrow(/Task ID T-001 already exists/);
	});

	it("Test 3: complex tags with commas and spaces survive round-trip", async () => {
		// Start with empty board
		await seedLog(tmpDir, []);

		// Reset modules to ensure fresh import with correct KANBAN_DIR
		vi.resetModules();

		// Dynamically import the module with fresh env
		const kanbanModule = await import("../extensions/kanban.ts");
		const kanban = kanbanModule.default as (pi: ExtensionAPI) => void;

		// Mock ExtensionAPI
		const mockPi = {
			registerTool: vi.fn(),
			registerFlag: vi.fn(),
			getFlag: vi.fn(),
		} as unknown as ExtensionAPI;

		// Call the extension to register tools
		kanban(mockPi);

		// Get the kanban_create tool
		const callsToRegisterTool = (mockPi.registerTool as any).mock.calls;
		const createToolCall = callsToRegisterTool.find(
			( call: any[]) => call[0]?.name === "kanban_create",
		);
		expect(createToolCall).toBeDefined();

		const createTool = createToolCall[0];

		// Call kanban_create with complex tags
		await createTool.execute("tool-call-id", {
			task_id: "T-002",
			agent: "test-agent",
			title: "Complex Task",
			priority: "critical",
			tags: "high priority, needs review, security fix",
		}, null);

		// Read the log and verify the tags and priority are quoted
		const logContent = await readFile(join(tmpDir, "board.log"), "utf-8");
		const lines = logContent.trim().split("\n");
		const createLine = lines.find((l) => l.includes("CREATE T-002"));
		expect(createLine).toBeDefined();
		// Verify priority and tags are quoted in the raw log
		expect(createLine).toContain('priority="critical"');
		expect(createLine).toContain('tags="high priority, needs review, security fix"');
	});
});
