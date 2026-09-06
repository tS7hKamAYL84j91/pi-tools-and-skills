/** Viewing, exporting and compaction are separate operations on disposable boards. */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBoard } from "../../extensions/pi-kanban/board.js";
import { callTool, setupKanbanToolHarness } from "./kanban-test-helpers.js";

const harness = setupKanbanToolHarness();
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

function tree(path: string): unknown {
	return readdirSync(path, { withFileTypes: true }).map((entry) => {
		const file = join(path, entry.name);
		const stat = statSync(file);
		return { name: entry.name, mode: stat.mode, mtime: stat.mtimeMs, content: entry.isDirectory() ? tree(file) : readFileSync(file, "utf8") };
	});
}

function largeLog(): string {
	return '2026-01-01T00:00:00.000Z CREATE T-001 lead title="Visible task" priority="high"\n' +
		'2026-01-01T00:00:01.000Z MOVE T-001 lead from=backlog to=todo\n'.repeat(600);
}

describe("read-only board views", () => {
	it("does not alter files, events or backups even above the former compaction threshold", async () => {
		harness.writeBoardLog(largeLog());
		writeFileSync(join(harness.tmpDir, "snapshot.md"), "Existing exported snapshot");
		const before = tree(harness.tmpDir);
		for (const params of [{}, { detail: "full" }, { task_id: "T-001" }, { show_all_done: true }]) {
			const result = await callTool(harness.tools, "kanban_snapshot", params);
			expect(result.details.readOnly).toBe(true);
			expect(result.content[0]?.text).toContain("T-001");
		}
		await callTool(harness.tools, "kanban_export_json", {});
		expect(tree(harness.tmpDir)).toEqual(before);
	});

	it("exports a requested Markdown view and one event without compacting", async () => {
		const before = largeLog();
		harness.writeBoardLog(before);
		const result = await callTool(harness.tools, "kanban_export", { task_id: "T-001" });
		expect(result.details.view).toBe("task");
		expect(readFileSync(join(harness.tmpDir, "snapshot.md"), "utf8")).toContain("# Kanban Task T-001");
		expect(harness.readBoardLog().startsWith(before)).toBe(true);
		expect(harness.readBoardLog()).toContain("SNAPSHOT T-SYS orchestrator seq=601");
		expect(harness.readBoardLog()).not.toContain("COMPACT");
		expect(readdirSync(harness.tmpDir)).not.toContain("archive");
	});

	it("compacts only on request and preserves distinct backups even at the same timestamp", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const original = largeLog();
		harness.writeBoardLog(original);
		const first = await callTool(harness.tools, "kanban_compact", {});
		const firstBackup = first.details.backupPath as string;
		expect(readFileSync(firstBackup, "utf8")).toBe(original);
		const compacted = harness.readBoardLog();
		expect(compacted).toContain("COMPACT");
		expect(compacted.length).toBeLessThan(original.length);
		const second = await callTool(harness.tools, "kanban_compact", {});
		expect(second.details.backupPath).not.toBe(firstBackup);
		expect(readFileSync(firstBackup, "utf8")).toBe(original);
		expect(readFileSync(second.details.backupPath as string, "utf8")).toBe(compacted);
	});

	it("retains owner and verification gates across explicit compaction", async () => {
		vi.stubEnv("KANBAN_REQUIRE_CHECK_EVIDENCE", "1");
		await callTool(harness.tools, "kanban_create", { task_id: "T-002", agent: "lead", title: "Guarded", priority: "high" });
		await callTool(harness.tools, "kanban_move", { task_id: "T-002", agent: "lead", to: "todo" });
		await callTool(harness.tools, "kanban_claim", { task_id: "T-002", agent: "owner" });
		await callTool(harness.tools, "kanban_compact", {});
		await expect(callTool(harness.tools, "kanban_complete", { task_id: "T-002", agent: "stranger" })).rejects.toThrow("not the claimed owner");
		await expect(callTool(harness.tools, "kanban_complete", { task_id: "T-002", agent: "owner" })).rejects.toThrow("requires verification evidence");
		await callTool(harness.tools, "kanban_complete", { task_id: "T-002", agent: "owner", checks: [{ command: "npm test", result: "pass", exit_code: 0 }] });
		await callTool(harness.tools, "kanban_compact", {});
		expect((await parseBoard()).tasks.get("T-002")).toMatchObject({ col: "done", doneAgent: "owner", verificationRequired: true, checks: [{ command: "npm test", result: "pass", exitCode: 0 }] });
	});
});
