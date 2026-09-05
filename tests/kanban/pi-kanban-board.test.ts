import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseBoard } from "../../extensions/pi-kanban/board.js";

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
	it("defaults omitted CREATE priority to medium for legacy events", async () => {
		writeFileSync(
			join(tmpDir, "board.log"),
			"2026-01-01T00:00:00Z CREATE T-001 legacy title=Legacy tags=\\\"\\\"",
		);
		const board = await parseBoard();
		expect(board.tasks.get("T-001")?.priority).toBe("medium");
	});

	it("throws an error when the board.log file does not exist", async () => {
		// KANBAN_DIR is set to tmpDir, but no board.log exists in it.
		await expect(parseBoard()).rejects.toThrow(/ENOENT/);
	});
});
