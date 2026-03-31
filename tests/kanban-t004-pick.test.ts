/**
 * TDD tests for T-004: Fix bugs in kanban_pick
 *
 * Bugs to fix:
 * 1. Wrong tie-breaking for T-NNN IDs (string vs numeric comparison)
 * 2. kanban_pick skips backlog tasks
 * 3. WIP_LIMIT hardcoded (should use env var)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanupDir, makeTmpKanbanDir, seedLog } from "./helpers.js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

describe("kanban_pick (T-004)", () => {
	let tmpDir: string;
	let savedKanbanDir: string | undefined;
	let savedWipLimit: string | undefined;

	beforeEach(async () => {
		// Save original env vars
		savedKanbanDir = process.env.KANBAN_DIR;
		savedWipLimit = process.env.KANBAN_WIP_LIMIT;

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

		if (savedWipLimit === undefined) {
			delete process.env.KANBAN_WIP_LIMIT;
		} else {
			process.env.KANBAN_WIP_LIMIT = savedWipLimit;
		}

		// Cleanup temp dir
		await cleanupDir(tmpDir);

		// Reset modules to clear any cached env vars
		vi.resetModules();
	});

	it("Test 1: picks T-2 over T-10 (numeric ID comparison, same priority)", async () => {
		// Seed two tasks with same priority
		await seedLog(tmpDir, [
			"2026-03-31T12:00:00Z CREATE T-2 agent1 title=\"Task 2\" priority=high tags=",
			"2026-03-31T12:00:00Z MOVE T-2 agent1 from=created to=todo",
			"2026-03-31T12:00:00Z CREATE T-10 agent1 title=\"Task 10\" priority=high tags=",
			"2026-03-31T12:00:00Z MOVE T-10 agent1 from=created to=todo",
		]);

		// Reset modules to ensure fresh import with correct KANBAN_DIR
		vi.resetModules();

		// Dynamically import the module with fresh env
		const kanbanModule = await import("../extensions/kanban.ts");
		const kanban = kanbanModule.default as (pi: ExtensionAPI) => void;

		// Mock ExtensionAPI
		const mockPi = {
			registerTool: vi.fn((tool) => {
				if (tool.name === "kanban_pick") {
					// Test the kanban_pick execute function
					// We'll execute it and check the result
				}
			}),
			registerFlag: vi.fn(),
			getFlag: vi.fn(),
		} as unknown as ExtensionAPI;

		// Call the extension to register tools
		kanban(mockPi);

		// Get the kanban_pick tool
		const callsToRegisterTool = (mockPi.registerTool as any).mock.calls;
		const pickToolCall = callsToRegisterTool.find(
			( call: any[]) => call[0]?.name === "kanban_pick",
		);
		expect(pickToolCall).toBeDefined();

		const pickTool = pickToolCall[0];
		const result = await pickTool.execute("tool-call-id", { agent: "test-agent" }, null);

		// Should pick T-2 (lower numeric ID) not T-10
		expect(result.details.result).toBe("T-2");
	});

	it("Test 2: picks task from backlog (not just todo)", async () => {
		// Seed a task in backlog only
		await seedLog(tmpDir, [
			"2026-03-31T12:00:00Z CREATE T-1 agent1 title=\"Backlog Task\" priority=high tags=",
			"2026-03-31T12:00:00Z MOVE T-1 agent1 from=created to=backlog",
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

		// Get the kanban_pick tool
		const callsToRegisterTool = (mockPi.registerTool as any).mock.calls;
		const pickToolCall = callsToRegisterTool.find(
			( call: any[]) => call[0]?.name === "kanban_pick",
		);
		expect(pickToolCall).toBeDefined();

		const pickTool = pickToolCall[0];
		const result = await pickTool.execute("tool-call-id", { agent: "test-agent" }, null);

		// Should pick T-1 from backlog, not return NO_TASK_AVAILABLE
		expect(result.details.result).toBe("T-1");
	});

	it("Test 3: respects KANBAN_WIP_LIMIT env var", async () => {
		// Set WIP limit to 1
		process.env.KANBAN_WIP_LIMIT = "1";

		// Seed one in-progress task
		await seedLog(tmpDir, [
			"2026-03-31T12:00:00Z CREATE T-1 agent1 title=\"In Progress\" priority=high tags=",
			"2026-03-31T12:00:00Z MOVE T-1 agent1 from=created to=in-progress",
			"2026-03-31T12:00:00Z CLAIM T-1 agent1 expires=2026-03-31T14:00:00Z",
			"2026-03-31T12:00:00Z CREATE T-2 agent1 title=\"Todo Task\" priority=high tags=",
			"2026-03-31T12:00:00Z MOVE T-2 agent1 from=created to=todo",
		]);

		// Reset modules to ensure fresh import with correct env vars
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

		// Get the kanban_pick tool
		const callsToRegisterTool = (mockPi.registerTool as any).mock.calls;
		const pickToolCall = callsToRegisterTool.find(
			( call: any[]) => call[0]?.name === "kanban_pick",
		);
		expect(pickToolCall).toBeDefined();

		const pickTool = pickToolCall[0];
		const result = await pickTool.execute("tool-call-id", { agent: "test-agent" }, null);

		// Should return WIP_LIMIT_REACHED because WIP limit is 1 and we have 1 in-progress
		expect(result.details.result).toBe("WIP_LIMIT_REACHED");
	});
});
