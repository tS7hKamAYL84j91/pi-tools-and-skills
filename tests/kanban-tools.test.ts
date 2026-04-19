/**
 * Integration tests for kanban tool wrappers (extensions/kanban/index.ts).
 *
 * Loads the extension against a fake ExtensionAPI that captures registered
 * tools by name, then exercises each tool's `execute` against a real temp
 * board.log. The watcher's session_start handler is captured but never
 * invoked, so no FSWatcher is started.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import type { ToolResult } from "../lib/tool-result.js";
import kanbanExtension from "../extensions/kanban/index.js";
import { WIP_LIMIT } from "../extensions/kanban/board.js";

// ── Fake ExtensionAPI ────────────────────────────────────────────

interface RegisteredTool {
	name: string;
	execute: (
		id: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
		onUpdate?: unknown,
		ctx?: { cwd?: string },
	) => Promise<ToolResult>;
}

interface FakeApi {
	registerTool: (def: RegisteredTool) => void;
	registerCommand: (name: string, opts: unknown) => void;
	registerShortcut: (shortcut: string, opts: unknown) => void;
	registerFlag: (name: string, opts: { default?: string | boolean }) => void;
	on: (event: string, handler: unknown) => void;
	getFlag: (name: string) => string | boolean | undefined;
	sendUserMessage: (msg: string, opts?: unknown) => void;
}

function createFakeApi(): { api: FakeApi; tools: Map<string, RegisteredTool> } {
	const tools = new Map<string, RegisteredTool>();
	const flags = new Map<string, string | boolean>();
	const api: FakeApi = {
		registerTool(def: RegisteredTool) { tools.set(def.name, def); },
		registerCommand(_name: string, _opts: unknown) { /* no-op */ },
		registerShortcut(_shortcut: string, _opts: unknown) { /* no-op */ },
		registerFlag(name: string, opts: { default?: string | boolean }) {
			if (opts.default !== undefined) flags.set(`--${name}`, opts.default);
		},
		on(_event: string, _handler: unknown) { /* captured but never fired */ },
		getFlag(name: string) { return flags.get(name); },
		sendUserMessage(_msg: string, _opts?: unknown) { /* no-op */ },
	};
	return { api, tools };
}

async function callTool(tools: Map<string, RegisteredTool>, name: string, params: Record<string, unknown>, cwd?: string): Promise<ToolResult> {
	const tool = tools.get(name);
	if (!tool) throw new Error(`Tool not registered: ${name}`);
	return tool.execute("test-call-id", params, undefined, undefined, cwd ? { cwd } : undefined);
}

// ── Test fixture ─────────────────────────────────────────────────

let tmpDir: string;
let prevKanbanDir: string | undefined;
let tools: Map<string, RegisteredTool>;

beforeEach(async () => {
	tmpDir = mkdtempSync(join(tmpdir(), "kanban-tools-test-"));
	mkdirSync(join(tmpDir, "tasks"), { recursive: true });
	// Touch board.log so parseBoard doesn't ENOENT
	const { writeFileSync } = await import("node:fs");
	writeFileSync(join(tmpDir, "board.log"), "", "utf-8");

	prevKanbanDir = process.env.KANBAN_DIR;
	process.env.KANBAN_DIR = tmpDir;

	// kanbanDir() reads KANBAN_DIR lazily on every call, so a static import is fine
	const fake = createFakeApi();
	kanbanExtension(fake.api as unknown as ExtensionAPI);
	tools = fake.tools;
});

afterEach(() => {
	if (prevKanbanDir === undefined) delete process.env.KANBAN_DIR;
	else process.env.KANBAN_DIR = prevKanbanDir;
	rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ────────────────────────────────────────────────────────

describe("kanban_create", () => {
	it("creates a task in backlog and writes log + task file", async () => {
		const result = await callTool(tools, "kanban_create", {
			task_id: "T-001",
			agent: "lead",
			title: "Build the thing",
			priority: "high",
			tags: "core,infra",
			description: "A task that builds the thing",
		});

		expect(result.isError).toBeFalsy();
		expect(result.content[0]?.text).toContain("Created T-001");
		expect(result.details.task_id).toBe("T-001");

		const log = readFileSync(join(tmpDir, "board.log"), "utf-8");
		expect(log).toContain("CREATE T-001 lead");
		expect(log).toContain('title="Build the thing"');
		expect(log).toContain('priority="high"');

		const taskFile = readFileSync(join(tmpDir, "tasks", "T-001.md"), "utf-8");
		expect(taskFile).toContain("title: \"Build the thing\"");
		expect(taskFile).toContain("priority: high");
		expect(taskFile).toContain("A task that builds the thing");
	});

	it("rejects duplicate task IDs", async () => {
		await callTool(tools, "kanban_create", { task_id: "T-002", agent: "lead", title: "First", priority: "low" });
		await expect(
			callTool(tools, "kanban_create", { task_id: "T-002", agent: "lead", title: "Second", priority: "low" }),
		).rejects.toThrow(/already exists/);
	});

	it("rejects malformed task IDs", async () => {
		await expect(
			callTool(tools, "kanban_create", { task_id: "bogus", agent: "lead", title: "x", priority: "low" }),
		).rejects.toThrow(/T-NNN/);
	});
});

describe("kanban_claim", () => {
	beforeEach(async () => {
		await callTool(tools, "kanban_create", { task_id: "T-010", agent: "lead", title: "Claimable", priority: "high" });
		// CREATE puts task in backlog; move it to todo so claim can pick it up
		await callTool(tools, "kanban_move", { task_id: "T-010", agent: "lead", to: "todo" });
	});

	it("claims a todo task and moves it to in-progress", async () => {
		const result = await callTool(tools, "kanban_claim", { task_id: "T-010", agent: "worker-1" });

		expect(result.isError).toBeFalsy();
		expect(result.details.result).toBe("CLAIMED");
		expect(result.details.claimed).toBe(true);

		const log = readFileSync(join(tmpDir, "board.log"), "utf-8");
		expect(log).toContain("CLAIM T-010 worker-1");
		expect(log).toContain("MOVE T-010 worker-1 from=todo to=in-progress");
	});

	it("returns TASK_NOT_FOUND for unknown task", async () => {
		const result = await callTool(tools, "kanban_claim", { task_id: "T-999", agent: "worker-1" });
		expect(result.details.result).toBe("TASK_NOT_FOUND");
		expect(result.details.claimed).toBe(false);
	});

	it("returns WRONG_COLUMN if task not in todo", async () => {
		await callTool(tools, "kanban_create", { task_id: "T-011", agent: "lead", title: "Backlog item", priority: "low" });
		// Still in backlog
		const result = await callTool(tools, "kanban_claim", { task_id: "T-011", agent: "worker-1" });
		expect(result.details.result).toBe("WRONG_COLUMN");
		expect(result.details.col).toBe("backlog");
	});

	it("returns WIP_LIMIT_REACHED when WIP cap is hit", async () => {
		// Fill WIP up to the limit using fresh tasks
		for (let i = 0; i < WIP_LIMIT; i++) {
			const id = `T-${String(20 + i).padStart(3, "0")}`;
			await callTool(tools, "kanban_create", { task_id: id, agent: "lead", title: id, priority: "medium" });
			await callTool(tools, "kanban_move", { task_id: id, agent: "lead", to: "todo" });
			const c = await callTool(tools, "kanban_claim", { task_id: id, agent: `worker${id.slice(2)}` });
			expect(c.details.result, `claim ${id}: ${c.content[0]?.text}`).toBe("CLAIMED");
		}
		// T-010 (already in todo from outer beforeEach) should now hit the cap
		const result = await callTool(tools, "kanban_claim", { task_id: "T-010", agent: "worker-extra" });
		expect(result.details.result, result.content[0]?.text).toBe("WIP_LIMIT_REACHED");
	});
});

describe("kanban_complete", () => {
	beforeEach(async () => {
		await callTool(tools, "kanban_create", { task_id: "T-030", agent: "lead", title: "To finish", priority: "high" });
		await callTool(tools, "kanban_move", { task_id: "T-030", agent: "lead", to: "todo" });
		await callTool(tools, "kanban_claim", { task_id: "T-030", agent: "worker-1" });
	});

	it("completes an in-progress task and moves it to done", async () => {
		const result = await callTool(tools, "kanban_complete", { task_id: "T-030", agent: "worker-1", duration: "45m" });
		expect(result.isError).toBeFalsy();
		expect(result.details.task_id).toBe("T-030");
		expect(result.details.duration).toBe("45m");

		const log = readFileSync(join(tmpDir, "board.log"), "utf-8");
		expect(log).toContain("COMPLETE T-030 worker-1 duration=45m");
		expect(log).toContain("MOVE T-030 worker-1 from=in-progress to=done");
	});

	it("rejects completing a task not in in-progress", async () => {
		await callTool(tools, "kanban_create", { task_id: "T-031", agent: "lead", title: "x", priority: "low" });
		await expect(
			callTool(tools, "kanban_complete", { task_id: "T-031", agent: "lead", duration: "1m" }),
		).rejects.toThrow(/not in-progress/);
	});

	it("defaults duration to 'unknown' when omitted", async () => {
		const result = await callTool(tools, "kanban_complete", { task_id: "T-030", agent: "worker-1" });
		expect(result.details.duration).toBe("unknown");
	});
});

describe("kanban_pick", () => {
	it("picks the highest-priority todo task", async () => {
		await callTool(tools, "kanban_create", { task_id: "T-040", agent: "lead", title: "low", priority: "low" });
		await callTool(tools, "kanban_create", { task_id: "T-041", agent: "lead", title: "critical", priority: "critical" });
		await callTool(tools, "kanban_create", { task_id: "T-042", agent: "lead", title: "medium", priority: "medium" });
		for (const id of ["T-040", "T-041", "T-042"]) {
			await callTool(tools, "kanban_move", { task_id: id, agent: "lead", to: "todo" });
		}

		const result = await callTool(tools, "kanban_pick", { agent: "worker-1" });
		expect(result.details.result).toBe("T-041");
		expect(result.details.claimed).toBe(true);
	});

	it("returns NO_TASK_AVAILABLE when nothing in todo", async () => {
		const result = await callTool(tools, "kanban_pick", { agent: "worker-1" });
		expect(result.details.result).toBe("NO_TASK_AVAILABLE");
	});
});

describe("kanban_note + kanban_block", () => {
	beforeEach(async () => {
		await callTool(tools, "kanban_create", { task_id: "T-050", agent: "lead", title: "Notable", priority: "medium" });
		await callTool(tools, "kanban_move", { task_id: "T-050", agent: "lead", to: "todo" });
		await callTool(tools, "kanban_claim", { task_id: "T-050", agent: "worker-1" });
	});

	it("appends a note to the log and the task file", async () => {
		const result = await callTool(tools, "kanban_note", { task_id: "T-050", agent: "worker-1", text: "halfway done" });
		expect(result.isError).toBeFalsy();

		const log = readFileSync(join(tmpDir, "board.log"), "utf-8");
		expect(log).toContain('NOTE T-050 worker-1 text="halfway done"');

		const taskFile = readFileSync(join(tmpDir, "tasks", "T-050.md"), "utf-8");
		expect(taskFile).toContain("halfway done");
	});

	it("blocks an in-progress task", async () => {
		const result = await callTool(tools, "kanban_block", { task_id: "T-050", agent: "worker-1", reason: "waiting on API key" });
		expect(result.isError).toBeFalsy();

		const log = readFileSync(join(tmpDir, "board.log"), "utf-8");
		expect(log).toContain('BLOCK T-050 worker-1 reason="waiting on API key"');
		expect(log).toContain("MOVE T-050 worker-1 from=in-progress to=blocked");
	});

	it("escapes embedded quotes in notes so the log round-trips through parseBoard", async () => {
		// The log parser only understands one pair of double quotes per field, so embedded
		// `"` characters must be replaced. Without escaping, the next snapshot would mis-parse.
		await callTool(tools, "kanban_note", {
			task_id: "T-050",
			agent: "worker-1",
			text: 'use "quotes" carefully',
		});

		// Raw log line should not contain a stray internal `"`
		const log = readFileSync(join(tmpDir, "board.log"), "utf-8");
		expect(log).toContain("use 'quotes' carefully");
		expect(log).not.toContain('text="use "quotes"');

		// Snapshot must still render the task without the parser losing fields after the bad quote
		const snap = await callTool(tools, "kanban_snapshot", {});
		expect(snap.isError).toBeFalsy();
		expect(snap.content[0]?.text).toContain("T-050");
		expect(snap.content[0]?.text).toContain("Notable");
	});
});

describe("kanban_snapshot", () => {
	it("writes snapshot.md and returns rendered board", async () => {
		await callTool(tools, "kanban_create", { task_id: "T-060", agent: "lead", title: "Snap me", priority: "high" });
		const result = await callTool(tools, "kanban_snapshot", {});

		expect(result.isError).toBeFalsy();
		expect(result.content[0]?.text).toContain("T-060");
		expect(existsSync(join(tmpDir, "snapshot.md"))).toBe(true);

		const snap = readFileSync(join(tmpDir, "snapshot.md"), "utf-8");
		expect(snap).toContain("T-060");
		expect(snap).toContain("Snap me");
	});
});
