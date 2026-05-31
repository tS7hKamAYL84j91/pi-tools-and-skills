import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach } from "vitest";
import kanbanExtension from "../../extensions/pi-kanban/index.js";
import type { ToolResult } from "../../lib/tool-result.js";

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
		registerTool(def: RegisteredTool) {
			tools.set(def.name, def);
		},
		registerCommand(_name: string, _opts: unknown) {
			// no-op
		},
		registerShortcut(_shortcut: string, _opts: unknown) {
			// no-op
		},
		registerFlag(name: string, opts: { default?: string | boolean }) {
			if (opts.default !== undefined) flags.set(`--${name}`, opts.default);
		},
		on(_event: string, _handler: unknown) {
			// captured but never fired
		},
		getFlag(name: string) {
			return flags.get(name);
		},
		sendUserMessage(_msg: string, _opts?: unknown) {
			// no-op
		},
	};
	return { api, tools };
}

export async function callTool(
	tools: Map<string, RegisteredTool>,
	name: string,
	params: Record<string, unknown>,
	cwd?: string,
): Promise<ToolResult> {
	const tool = tools.get(name);
	if (!tool) throw new Error(`Tool not registered: ${name}`);
	return tool.execute(
		"test-call-id",
		params,
		undefined,
		undefined,
		cwd ? { cwd } : undefined,
	);
}

interface TempKanbanDir {
	readonly tmpDir: string;
	readBoardLog(): string;
	readTaskFile(taskId: string): string;
	writeBoardLog(content: string): void;
}

export function setupTempKanbanDir(prefix: string): TempKanbanDir {
	let tmpDir = "";
	let prevKanbanDir: string | undefined;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), prefix));
		mkdirSync(join(tmpDir, "tasks"), { recursive: true });
		writeFileSync(join(tmpDir, "board.log"), "", "utf-8");

		prevKanbanDir = process.env.KANBAN_DIR;
		process.env.KANBAN_DIR = tmpDir;
	});

	afterEach(() => {
		if (prevKanbanDir === undefined) delete process.env.KANBAN_DIR;
		else process.env.KANBAN_DIR = prevKanbanDir;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	return {
		get tmpDir() {
			return tmpDir;
		},
		readBoardLog() {
			return readFileSync(join(tmpDir, "board.log"), "utf-8");
		},
		readTaskFile(taskId: string) {
			return readFileSync(join(tmpDir, "tasks", `${taskId}.md`), "utf-8");
		},
		writeBoardLog(content: string) {
			writeFileSync(join(tmpDir, "board.log"), content, "utf-8");
		},
	};
}

interface KanbanToolHarness extends TempKanbanDir {
	readonly tools: Map<string, RegisteredTool>;
}

export function setupKanbanToolHarness(): KanbanToolHarness {
	const tempDir = setupTempKanbanDir("kanban-tools-test-");
	let tools = new Map<string, RegisteredTool>();

	beforeEach(() => {
		const fake = createFakeApi();
		kanbanExtension(fake.api as unknown as ExtensionAPI);
		tools = fake.tools;
	});

	return {
		get tmpDir() {
			return tempDir.tmpDir;
		},
		get tools() {
			return tools;
		},
		readBoardLog() {
			return tempDir.readBoardLog();
		},
		readTaskFile(taskId: string) {
			return tempDir.readTaskFile(taskId);
		},
		writeBoardLog(content: string) {
			tempDir.writeBoardLog(content);
		},
	};
}
