import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseBoard } from "../../extensions/pi-kanban/board.js";
import { KanbanEventVersionError } from "../../extensions/pi-kanban/board-events.js";

let tmpDir: string;
let previousKanbanDir: string | undefined;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "kanban-board-test-"));
	previousKanbanDir = process.env.KANBAN_DIR;
	process.env.KANBAN_DIR = tmpDir;
});

afterEach(() => {
	if (previousKanbanDir === undefined) {
		delete process.env.KANBAN_DIR;
	} else {
		process.env.KANBAN_DIR = previousKanbanDir;
	}
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("parseBoard", () => {
	it("defaults a CREATE event with no priority to medium", async () => {
		writeFileSync(
			join(tmpDir, "board.events.jsonl"),
			`${JSON.stringify({
				v: 1,
				ts: "2026-01-01T00:00:00Z",
				type: "create",
				task_id: "T-001",
				agent: "legacy",
				title: "Legacy",
				tags: "",
			})}\n`,
		);
		const board = await parseBoard();
		expect(board.tasks.get("T-001")?.priority).toBe("medium");
	});

	it("throws when the board log file does not exist", async () => {
		// KANBAN_DIR is set to tmpDir, but no board.events.jsonl exists in it.
		await expect(parseBoard()).rejects.toThrow(/ENOENT/);
	});

	it("fails loud when a line was written by a newer event version", async () => {
		writeFileSync(
			join(tmpDir, "board.events.jsonl"),
			`${JSON.stringify({ v: 2, ts: "2026-01-01T00:00:00Z", type: "create", task_id: "T-001", agent: "future" })}\n`,
		);
		await expect(parseBoard()).rejects.toThrow(KanbanEventVersionError);
	});

	it("counts unknown lines at a known version instead of silently dropping them", async () => {
		const valid = JSON.stringify({ v: 1, ts: "2026-01-01T00:00:00Z", type: "create", task_id: "T-001", agent: "lead", title: "Kept" });
		const unknown = JSON.stringify({ v: 1, ts: "2026-01-01T00:00:01Z", type: "snapshot", task_id: "T-SYS", agent: "orchestrator" });
		writeFileSync(join(tmpDir, "board.events.jsonl"), `${valid}\n${unknown}\n`);

		const board = await parseBoard();
		expect(board.tasks.get("T-001")?.title).toBe("Kept");
		expect(board.totalEvents).toBe(1);
		expect(board.skippedEvents).toBe(1);
	});
});
