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
	const create = JSON.stringify({ v: 1, ts: "2026-01-01T00:00:00.000Z", type: "create", task_id: "T-001", agent: "lead", title: "Visible task", priority: "high" });
	const move = JSON.stringify({ v: 1, ts: "2026-01-01T00:00:01.000Z", type: "move", task_id: "T-001", agent: "lead", from: "backlog", to: "todo" });
	return `${create}\n${Array.from({ length: 600 }, () => move).join("\n")}\n`;
}

describe("read-only board views", () => {
	it("does not alter files, events or backups even above the former compaction threshold", async () => {
		harness.writeEventLog(largeLog());
		writeFileSync(join(harness.tmpDir, "snapshot.md"), "Existing exported snapshot");
		const before = tree(harness.tmpDir);
		const result = await callTool(harness.tools, "kanban_export_json", {});
		expect(result.content[0]?.text).toContain("T-001");
		expect(tree(harness.tmpDir)).toEqual(before);
	});

	it("removes snapshot tools but reads historical SNAPSHOT events without mutating them", async () => {
		expect(harness.tools.has("kanban_snapshot")).toBe(false);
		expect(harness.tools.has("kanban_export")).toBe(false);
		const original = `${largeLog()}${JSON.stringify({ v: 1, ts: "2026-01-01T00:00:02Z", type: "snapshot", task_id: "T-SYS", agent: "orchestrator", seq: 601 })}\n`;
		harness.writeEventLog(original);
		expect((await parseBoard()).tasks.get("T-001")?.title).toBe("Visible task");
		await callTool(harness.tools, "kanban_export_json", {});
		expect(harness.readEventLog()).toBe(original);
	});

	it("compacts only on request and preserves distinct backups even at the same timestamp", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const original = largeLog();
		harness.writeEventLog(original);
		const first = await callTool(harness.tools, "kanban_compact", {});
		const firstBackup = first.details.backupPath as string;
		expect(readFileSync(firstBackup, "utf8")).toBe(original);
		const compacted = harness.readEventLog();
		expect(compacted).not.toBe(original);
		expect(compacted.split("\n").filter(Boolean).every((line) => (JSON.parse(line) as { v: number }).v === 1)).toBe(true);
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
