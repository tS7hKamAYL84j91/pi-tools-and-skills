/**
 * TDD tests for T-007: Fix bugs in kanban_monitor and kanban_complete
 *
 * Bugs to fix:
 * 1. MONITOR_STATE_DIR hardcoded → should read from KANBAN_MONITOR_STATE_DIR env
 * 2. kanban_complete doesn't clean up stall state → should call setStallCount(0) and saveHash('')
 * 3. REPORT.md base path hardcoded → should read from KANBAN_REPORT_BASE env
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanupDir, makeTmpKanbanDir, seedLog } from "./helpers.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

describe("kanban_monitor stall-state & REPORT.md path fixes (T-007)", () => {
	let tmpDir: string;
	let monitorStateDir: string;
	let reportBaseDir: string;
	let savedKanbanDir: string | undefined;
	let savedMonitorStateDir: string | undefined;
	let savedReportBase: string | undefined;

	beforeEach(async () => {
		// Save original env vars
		savedKanbanDir = process.env.KANBAN_DIR;
		savedMonitorStateDir = process.env.KANBAN_MONITOR_STATE_DIR;
		savedReportBase = process.env.KANBAN_REPORT_BASE;

		// Create isolated dirs
		tmpDir = await makeTmpKanbanDir();
		monitorStateDir = await mkdtemp(join(tmpdir(), "kanban-monitor-state-"));
		reportBaseDir = await mkdtemp(join(tmpdir(), "kanban-report-base-"));

		// Set env vars before module import
		process.env.KANBAN_DIR = tmpDir;
		process.env.KANBAN_MONITOR_STATE_DIR = monitorStateDir;
		process.env.KANBAN_REPORT_BASE = reportBaseDir;
	});

	afterEach(async () => {
		// Restore original env vars
		if (savedKanbanDir === undefined) {
			delete process.env.KANBAN_DIR;
		} else {
			process.env.KANBAN_DIR = savedKanbanDir;
		}

		if (savedMonitorStateDir === undefined) {
			delete process.env.KANBAN_MONITOR_STATE_DIR;
		} else {
			process.env.KANBAN_MONITOR_STATE_DIR = savedMonitorStateDir;
		}

		if (savedReportBase === undefined) {
			delete process.env.KANBAN_REPORT_BASE;
		} else {
			process.env.KANBAN_REPORT_BASE = savedReportBase;
		}

		// Clean up test dirs
		await cleanupDir(tmpDir);
		await cleanupDir(monitorStateDir);
		await cleanupDir(reportBaseDir);

		// Reset modules so env vars are re-read
		vi.resetModules();
	});

	it("Test 1: KANBAN_MONITOR_STATE_DIR env var is used instead of /tmp/kanban-monitor-state", async () => {
		// Seed a task in-progress
		await seedLog(tmpDir, [
			"2026-03-31T12:00:00Z CREATE T-100 agent1 title=\"Test Task\" priority=high tags=",
			"2026-03-31T12:00:01Z MOVE T-100 agent1 from=created to=in-progress",
		]);

		// Reset modules to pick up KANBAN_MONITOR_STATE_DIR env var
		vi.resetModules();
		const kanbanModule = await import("../extensions/kanban.ts");
		const kanban = kanbanModule.default as (pi: ExtensionAPI) => void;

		// Mock ExtensionAPI
		const tools = new Map();
		const flags = new Map<string, boolean>();
		const mockPi = {
			registerTool: (t: any) => tools.set(t.name, t),
			registerFlag: (name: string, config: any) => {
				flags.set(name, config.default ?? false);
			},
			getFlag: (flag: string) => flags.get(flag) ?? false,
		} as unknown as ExtensionAPI;

		kanban(mockPi);

		// Get kanban_complete tool
		const completeTool = tools.get("kanban_complete");
		expect(completeTool).toBeDefined();

		// Before running, write stall state to the env-specified dir
		await mkdir(monitorStateDir, { recursive: true });
		await writeFile(join(monitorStateDir, "T-100.stall"), "2", "utf-8");
		await writeFile(join(monitorStateDir, "T-100.hash"), "somehash123", "utf-8");

		// Execute complete
		const result = await completeTool.execute("tool-call-id", {
			task_id: "T-100",
			agent: "agent1",
			duration: "10m",
		}, null);

		expect(result.content[0].text).toContain("Completed T-100");

		// Verify stall state was cleaned up in KANBAN_MONITOR_STATE_DIR (env var, not /tmp)
		const stallFile = join(monitorStateDir, "T-100.stall");
		const stallContent = await readFile(stallFile, "utf-8");
		expect(stallContent.trim()).toBe("0");

		const hashFile = join(monitorStateDir, "T-100.hash");
		const hashContent = await readFile(hashFile, "utf-8");
		expect(hashContent.trim()).toBe("");
	});

	it("Test 2: kanban_complete cleans up stall state after logging COMPLETE", async () => {
		// Seed an in-progress task
		await seedLog(tmpDir, [
			"2026-03-31T12:00:00Z CREATE T-101 agent1 title=\"Another Task\" priority=high tags=",
			"2026-03-31T12:00:00Z MOVE T-101 agent1 from=created to=in-progress",
		]);

		vi.resetModules();
		const kanbanModule = await import("../extensions/kanban.ts");
		const kanban = kanbanModule.default as (pi: ExtensionAPI) => void;

		const tools = new Map();
		const flags = new Map<string, boolean>();
		const mockPi = {
			registerTool: (t: any) => tools.set(t.name, t),
			registerFlag: (name: string, config: any) => {
				flags.set(name, config.default ?? false);
			},
			getFlag: (flag: string) => flags.get(flag) ?? false,
		} as unknown as ExtensionAPI;

		kanban(mockPi);

		// Pre-populate stall state
		await mkdir(monitorStateDir, { recursive: true });
		await writeFile(join(monitorStateDir, "T-101.stall"), "5", "utf-8");
		await writeFile(join(monitorStateDir, "T-101.hash"), "hash456", "utf-8");

		const completeTool = tools.get("kanban_complete");

		// Complete the task
		await completeTool.execute("tool-call-id", {
			task_id: "T-101",
			agent: "agent1",
			duration: "30m",
		}, null);

		// Verify stall count is 0 in state dir
		const stallVal = await readFile(join(monitorStateDir, "T-101.stall"), "utf-8");
		expect(parseInt(stallVal.trim(), 10)).toBe(0);

		// Verify hash is empty
		const hashVal = await readFile(join(monitorStateDir, "T-101.hash"), "utf-8");
		expect(hashVal.trim()).toBe("");

		// Verify board.log has COMPLETE event
		const logContent = await readFile(join(tmpDir, "board.log"), "utf-8");
		expect(logContent).toContain("COMPLETE T-101");
	});

	it("Test 3: kanban_monitor checks REPORT.md in KANBAN_REPORT_BASE path", async () => {
		// Seed an in-progress task
		await seedLog(tmpDir, [
			"2026-03-31T12:00:00Z CREATE T-102 researcher title=\"Research Task\" priority=high tags=",
			"2026-03-31T12:00:00Z CLAIM T-102 researcher expires=2026-03-31T14:00:00Z",
			"2026-03-31T12:00:00Z MOVE T-102 researcher from=backlog to=in-progress",
		]);

		vi.resetModules();
		const kanbanModule = await import("../extensions/kanban.ts");
		const kanban = kanbanModule.default as (pi: ExtensionAPI) => void;

		const tools = new Map();
		const flags = new Map<string, boolean>();
		const mockPi = {
			registerTool: (t: any) => tools.set(t.name, t),
			registerFlag: (name: string, config: any) => {
				flags.set(name, config.default ?? false);
			},
			getFlag: (flag: string) => flags.get(flag) ?? false,
		} as unknown as ExtensionAPI;

		kanban(mockPi);

		// Create REPORT.md in the env-specified KANBAN_REPORT_BASE dir
		const reportPath = join(reportBaseDir, "researcher", "REPORT.md");
		await mkdir(join(reportBaseDir, "researcher"), { recursive: true });
		await writeFile(reportPath, "# Research Report\n\nDone!", "utf-8");

		const monitorTool = tools.get("kanban_monitor");
		expect(monitorTool).toBeDefined();

		// Run monitor
		const result = await monitorTool.execute("tool-call-id", {
			prod: false,
			stall_cycles: 3,
			verbose: false,
		}, null);

		// The result should show T-102 as DONE
		expect(result.content[0].text).toContain("DONE");
		expect(result.content[0].text).toContain("T-102");

		// Check details for task status
		const taskDetail = result.details.tasks.find((t: any) => t.id === "T-102");
		expect(taskDetail).toBeDefined();
		expect(taskDetail.status).toBe("DONE");
	});

	it("Test 4: kanban_monitor respects KANBAN_REPORT_BASE for report discovery", async () => {
		// Seed a task
		await seedLog(tmpDir, [
			"2026-03-31T12:00:00Z CREATE T-103 worker title=\"Work Task\" priority=high tags=",
			"2026-03-31T12:00:00Z CLAIM T-103 worker expires=2026-03-31T14:00:00Z",
			"2026-03-31T12:00:00Z MOVE T-103 worker from=backlog to=in-progress",
		]);

		vi.resetModules();
		const kanbanModule = await import("../extensions/kanban.ts");
		const kanban = kanbanModule.default as (pi: ExtensionAPI) => void;

		const tools = new Map();
		const flags = new Map<string, boolean>();
		const mockPi = {
			registerTool: (t: any) => tools.set(t.name, t),
			registerFlag: (name: string, config: any) => {
				flags.set(name, config.default ?? false);
			},
			getFlag: (flag: string) => flags.get(flag) ?? false,
		} as unknown as ExtensionAPI;

		kanban(mockPi);

		// Verify that REPORT.md in custom KANBAN_REPORT_BASE is found
		const reportPath = join(reportBaseDir, "worker", "REPORT.md");
		await mkdir(join(reportBaseDir, "worker"), { recursive: true });
		await writeFile(reportPath, "# Worker Report\n\nCompleted!", "utf-8");

		const monitorTool = tools.get("kanban_monitor");

		// Run monitor with custom report base
		const result = await monitorTool.execute("tool-call-id", {
			prod: false,
			stall_cycles: 3,
			verbose: false,
		}, null);

		// Task should be marked as DONE since REPORT.md exists
		const taskDetail = result.details.tasks.find((t: any) => t.id === "T-103");
		expect(taskDetail).toBeDefined();
		expect(taskDetail.status).toBe("DONE");
	});
});
