/**
 * Legacy board.log -> typed board.events.jsonl migration.
 *
 * The extension no longer reads the text format; this covers the one-time
 * script and a JSONL codec round-trip.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseBoard } from "../../extensions/pi-kanban/board.js";
import {
	kanbanEventCodec,
	type KanbanEvent,
} from "../../extensions/pi-kanban/board-events.js";

const LEGACY = [
	'2026-01-01T00:00:00Z CREATE T-001 lead title="First" priority="high" tags="a,b" description="hello world"',
	"2026-01-01T00:00:01Z MOVE T-001 lead from=backlog to=todo",
	"2026-01-01T00:00:02Z CLAIM T-001 worker-1 expires=2026-01-02T00:00:00.000Z model=opus",
	"2026-01-01T00:00:03Z NOTE T-001 worker-1 text=\"use 'quotes' carefully\"",
	// formatChecks JSON, then escapeLogValue turned `"` into `'`.
	"2026-01-01T00:00:04Z COMPLETE T-001 worker-1 duration=45m verification_required=true checks=\"[{'command':'npm test','result':'pass','exit_code':0}]\"",
].join("\n");

let dir = "";
let previousKanbanDir: string | undefined;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "kanban-migrate-test-"));
	previousKanbanDir = process.env.KANBAN_DIR;
	process.env.KANBAN_DIR = dir;
});

afterEach(() => {
	if (previousKanbanDir === undefined) delete process.env.KANBAN_DIR;
	else process.env.KANBAN_DIR = previousKanbanDir;
	rmSync(dir, { recursive: true, force: true });
});

function migrate(args: string[] = []): string {
	return execFileSync(process.execPath, ["scripts/migrate-kanban-log.mjs", dir, ...args], {
		encoding: "utf-8",
	});
}

describe("migrate-kanban-log.mjs", () => {
	it("converts legacy text events into typed JSONL and archives the old log", async () => {
		writeFileSync(join(dir, "board.log"), `${LEGACY}\n`, "utf-8");
		migrate();

		expect(existsSync(join(dir, "board.events.jsonl"))).toBe(true);
		expect(existsSync(join(dir, "board.log"))).toBe(false);
		expect(
			readdirSync(join(dir, "archive")).some((name) => name.startsWith("board.log.migrated.")),
		).toBe(true);

		const task = (await parseBoard()).tasks.get("T-001");
		expect(task).toMatchObject({
			title: "First",
			priority: "high",
			tags: "a,b",
			description: "hello world",
			col: "done",
			model: "opus",
			verificationRequired: true,
			checks: [{ command: "npm test", result: "pass", exitCode: 0 }],
		});
		expect(task?.notes[0]).toContain("use 'quotes' carefully");
	});

	it("dry-run writes nothing", () => {
		writeFileSync(join(dir, "board.log"), `${LEGACY}\n`, "utf-8");
		expect(migrate(["--dry-run"])).toContain("[dry-run]");
		expect(existsSync(join(dir, "board.events.jsonl"))).toBe(false);
		expect(existsSync(join(dir, "board.log"))).toBe(true);
	});

	it("refuses to overwrite an existing target without --force", () => {
		writeFileSync(join(dir, "board.log"), `${LEGACY}\n`, "utf-8");
		writeFileSync(join(dir, "board.events.jsonl"), "", "utf-8");
		expect(() => migrate()).toThrow();
	});
});

describe("kanbanEventCodec", () => {
	it("round-trips embedded newlines, quotes and unicode", () => {
		const event: KanbanEvent = {
			v: 1,
			ts: "2026-01-01T00:00:00Z",
			type: "note",
			task_id: "T-001",
			agent: "worker-1",
			text: 'line1 "quoted"\nline2 café ✅',
		};
		const encoded = kanbanEventCodec.encode(event);
		expect(encoded).not.toContain("\n");
		expect(kanbanEventCodec.decode(encoded)).toEqual(event);
	});

	it("rejects a line that is not a valid typed event", () => {
		expect(() => kanbanEventCodec.decode('{"v":1,"type":"snapshot","task_id":"T-SYS"}')).toThrow();
	});
});
