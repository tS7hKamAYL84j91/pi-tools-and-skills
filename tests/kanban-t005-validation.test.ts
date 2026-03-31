/**
 * TDD tests for T-005: Fix bugs in kanban_complete and kanban_block
 *
 * Bugs to fix:
 * 1. kanban_block: no validation — should check task exists and is in-progress
 * 2. kanban_complete: same issue — should check task exists and is in-progress
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanupDir, makeTmpKanbanDir, seedLog } from "./helpers.js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

describe("kanban_complete and kanban_block validation (T-005)", () => {
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

	it("Test 1: kanban_block on a todo task throws with col=todo", async () => {
		// Seed a task in todo state
		await seedLog(tmpDir, [
			"2026-03-31T12:00:00Z CREATE T-001 agent1 title=\"Test Task\" priority=medium tags=",
			"2026-03-31T12:00:00Z MOVE T-001 agent1 from=backlog to=todo",
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

		// Get the kanban_block tool
		const callsToRegisterTool = (mockPi.registerTool as any).mock.calls;
		const blockToolCall = callsToRegisterTool.find(
			( call: any[]) => call[0]?.name === "kanban_block",
		);
		expect(blockToolCall).toBeDefined();

		const blockTool = blockToolCall[0];
		
		// Should throw an error when trying to block a todo task
		await expect(
			blockTool.execute("tool-call-id", {
				task_id: "T-001",
				agent: "test-agent",
				reason: "test reason",
			}, null)
		).rejects.toThrow(/T-001 is not in-progress.*col=todo/);
	});

	it("Test 2: kanban_complete on a done task throws with col=done", async () => {
		// Seed a task in done state
		await seedLog(tmpDir, [
			"2026-03-31T12:00:00Z CREATE T-002 agent1 title=\"Done Task\" priority=medium tags=",
			"2026-03-31T12:00:00Z MOVE T-002 agent1 from=backlog to=todo",
			"2026-03-31T12:00:00Z CLAIM T-002 agent1 expires=2026-03-31T14:00:00Z",
			"2026-03-31T12:00:00Z MOVE T-002 agent1 from=todo to=in-progress",
			"2026-03-31T12:00:01Z COMPLETE T-002 agent1 duration=1h",
			"2026-03-31T12:00:02Z MOVE T-002 agent1 from=in-progress to=done",
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

		// Get the kanban_complete tool
		const callsToRegisterTool = (mockPi.registerTool as any).mock.calls;
		const completeToolCall = callsToRegisterTool.find(
			( call: any[]) => call[0]?.name === "kanban_complete",
		);
		expect(completeToolCall).toBeDefined();

		const completeTool = completeToolCall[0];
		
		// Should throw an error when trying to complete a done task
		await expect(
			completeTool.execute("tool-call-id", {
				task_id: "T-002",
				agent: "agent1",
				duration: "1h",
			}, null)
		).rejects.toThrow(/T-002 is not in-progress.*col=done/);
	});

	it("Test 3: kanban_block on nonexistent task throws 'not found'", async () => {
		// Empty board (no tasks)
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

		// Get the kanban_block tool
		const callsToRegisterTool = (mockPi.registerTool as any).mock.calls;
		const blockToolCall = callsToRegisterTool.find(
			( call: any[]) => call[0]?.name === "kanban_block",
		);
		expect(blockToolCall).toBeDefined();

		const blockTool = blockToolCall[0];
		
		// Should throw an error for nonexistent task
		await expect(
			blockTool.execute("tool-call-id", {
				task_id: "T-999",
				agent: "test-agent",
				reason: "test reason",
			}, null)
		).rejects.toThrow(/Task T-999 not found/);
	});

	it("Test 4: kanban_block on in-progress task succeeds (no throw)", async () => {
		// Seed a task in in-progress state
		await seedLog(tmpDir, [
			"2026-03-31T12:00:00Z CREATE T-003 agent1 title=\"In Progress Task\" priority=medium tags=",
			"2026-03-31T12:00:00Z MOVE T-003 agent1 from=backlog to=todo",
			"2026-03-31T12:00:01Z CLAIM T-003 agent1 expires=2026-03-31T14:00:00Z",
			"2026-03-31T12:00:02Z MOVE T-003 agent1 from=todo to=in-progress",
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

		// Get the kanban_block tool
		const callsToRegisterTool = (mockPi.registerTool as any).mock.calls;
		const blockToolCall = callsToRegisterTool.find(
			( call: any[]) => call[0]?.name === "kanban_block",
		);
		expect(blockToolCall).toBeDefined();

		const blockTool = blockToolCall[0];
		
		// Should succeed without throwing
		const result = await blockTool.execute("tool-call-id", {
			task_id: "T-003",
			agent: "agent1",
			reason: "waiting for API key",
		}, null);

		// Verify result is successful
		expect(result.content).toBeDefined();
		expect(result.content[0].text).toContain("Blocked T-003");
		expect(result.details.task_id).toBe("T-003");
	});

	it("Test 5: kanban_complete on in-progress task succeeds", async () => {
		// Seed a task in in-progress state
		await seedLog(tmpDir, [
			"2026-03-31T12:00:00Z CREATE T-004 agent1 title=\"Ready to Complete\" priority=medium tags=",
			"2026-03-31T12:00:00Z MOVE T-004 agent1 from=backlog to=todo",
			"2026-03-31T12:00:01Z CLAIM T-004 agent1 expires=2026-03-31T14:00:00Z",
			"2026-03-31T12:00:02Z MOVE T-004 agent1 from=todo to=in-progress",
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

		// Get the kanban_complete tool
		const callsToRegisterTool = (mockPi.registerTool as any).mock.calls;
		const completeToolCall = callsToRegisterTool.find(
			( call: any[]) => call[0]?.name === "kanban_complete",
		);
		expect(completeToolCall).toBeDefined();

		const completeTool = completeToolCall[0];
		
		// Should succeed without throwing
		const result = await completeTool.execute("tool-call-id", {
			task_id: "T-004",
			agent: "agent1",
			duration: "45m",
		}, null);

		// Verify result is successful
		expect(result.content).toBeDefined();
		expect(result.content[0].text).toContain("Completed T-004");
		expect(result.details.task_id).toBe("T-004");
		expect(result.details.duration).toBe("45m");
	});
});
