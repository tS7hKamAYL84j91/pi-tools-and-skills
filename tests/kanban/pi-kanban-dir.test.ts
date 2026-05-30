import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boardLogPath } from "../../extensions/pi-kanban/board.js";

let tmpDir: string;
let previousCwd: string;
let previousKanbanDir: string | undefined;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "kanban-dir-test-"));
	previousCwd = process.cwd();
	previousKanbanDir = process.env.KANBAN_DIR;
	delete process.env.KANBAN_DIR;
	process.chdir(tmpDir);
});

afterEach(() => {
	process.chdir(previousCwd);
	if (previousKanbanDir === undefined) {
		delete process.env.KANBAN_DIR;
	} else {
		process.env.KANBAN_DIR = previousKanbanDir;
	}
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("Kanban directory resolution", () => {
	it("does not fall back to the legacy unprefixed kanban directory", () => {
		mkdirSync(join(tmpDir, "kanban"), { recursive: true });

		expect(() => boardLogPath()).toThrow(
			"Kanban directory not found. Set KANBAN_DIR or create a 'pi-kanban' directory in the current working directory.",
		);
	});

	it("uses the strict pi-kanban cwd fallback", () => {
		mkdirSync(join(tmpDir, "kanban"), { recursive: true });
		mkdirSync(join(tmpDir, "pi-kanban"), { recursive: true });

		expect(boardLogPath()).toBe(join(process.cwd(), "pi-kanban", "board.log"));
	});
});
