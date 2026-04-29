/**
 * Tests for the pi-coas extension tool wrappers and workspace helpers.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ToolResult } from "../lib/tool-result.js";
import piCoasExtension from "../extensions/pi-coas/index.js";

interface TestContext {
	cwd: string;
	hasUI: boolean;
	ui: {
		setStatus: (key: string, value: string | undefined) => void;
		setWidget: (key: string, value: string[] | undefined) => void;
		notify: (message: string, level: string) => void;
		confirm: (title: string, message: string) => Promise<boolean>;
	};
}

interface RegisteredTool {
	name: string;
	execute: (
		id: string,
		params: Record<string, never>,
		signal?: AbortSignal,
		onUpdate?: unknown,
		ctx?: TestContext,
	) => Promise<ToolResult>;
}

interface RegisteredCommand {
	handler: (args: string, ctx: TestContext) => Promise<unknown> | unknown;
}

type RegisteredHandler = (event: Record<string, unknown>, ctx: TestContext) => Promise<unknown> | unknown;

interface ExecCall {
	command: string;
	args: string[];
}

function createFakeApi(execResult = { stdout: "ok", stderr: "", code: 0 }) {
	const tools = new Map<string, RegisteredTool>();
	const commands = new Map<string, RegisteredCommand>();
	const handlers = new Map<string, RegisteredHandler>();
	const execCalls: ExecCall[] = [];
	const api = {
		registerTool(def: RegisteredTool) { tools.set(def.name, def); },
		registerCommand(name: string, opts: RegisteredCommand) { commands.set(name, opts); },
		registerShortcut(_key: string, _opts: unknown) { /* no-op */ },
		registerFlag(_name: string, _opts: unknown) { /* no-op */ },
		on(event: string, handler: RegisteredHandler) { handlers.set(event, handler); },
		getFlag(_name: string) { return undefined; },
		sendUserMessage(_message: string, _options?: unknown) { /* no-op */ },
		exec(command: string, args: string[]) {
			execCalls.push({ command, args });
			return Promise.resolve(execResult);
		},
	};
	return { api: api as unknown as ExtensionAPI, tools, commands, handlers, execCalls };
}

function makeCtx(cwd: string): TestContext {
	return {
		cwd,
		hasUI: true,
		ui: {
			setStatus: () => { /* no-op */ },
			setWidget: () => { /* no-op */ },
			notify: () => { /* no-op */ },
			confirm: async () => true,
		},
	};
}

async function callTool(
	tools: Map<string, RegisteredTool>,
	name: string,
	params: Record<string, unknown>,
	ctx: TestContext,
): Promise<ToolResult> {
	const tool = tools.get(name);
	if (!tool) throw new Error(`Tool not registered: ${name}`);
	return tool.execute("test", params as Record<string, never>, undefined, undefined, ctx);
}

function writeScript(path: string): void {
	writeFileSync(path, "#!/usr/bin/env bash\necho script ok\n", "utf8");
	chmodSync(path, 0o755);
}

let root: string;
let coasDir: string;
let coasHome: string;
let cwd: string;
let oldCoasDir: string | undefined;
let oldCoasHome: string | undefined;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pi-coas-test-"));
	coasDir = join(root, "coas");
	coasHome = join(root, "coas-home");
	cwd = join(root, "workspace");
	mkdirSync(join(coasDir, "scripts"), { recursive: true });
	mkdirSync(coasHome, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	for (const script of ["coas-status", "coas-doctor", "coas-schedule", "coas-new-room"]) {
		writeScript(join(coasDir, "scripts", script));
	}
	oldCoasDir = process.env.COAS_DIR;
	oldCoasHome = process.env.COAS_HOME;
	process.env.COAS_DIR = coasDir;
	process.env.COAS_HOME = coasHome;
});

afterEach(() => {
	if (oldCoasDir === undefined) delete process.env.COAS_DIR;
	else process.env.COAS_DIR = oldCoasDir;
	if (oldCoasHome === undefined) delete process.env.COAS_HOME;
	else process.env.COAS_HOME = oldCoasHome;
	rmSync(root, { recursive: true, force: true });
});

describe("pi-coas script wrapper tools", () => {
	it("runs coas-status through env with COAS_HOME and absolute script path", async () => {
		const fake = createFakeApi({ stdout: "CoAS status", stderr: "", code: 0 });
		piCoasExtension(fake.api);

		const result = await callTool(fake.tools, "coas_status", {}, makeCtx(cwd));

		expect(result.content[0]?.text).toContain("CoAS status");
		expect(fake.execCalls[0]).toEqual({
			command: "env",
			args: [`COAS_HOME=${coasHome}`, join(coasDir, "scripts", "coas-status")],
		});
	});

	it("schedule add passes narrow arguments and does not install cron", async () => {
		const fake = createFakeApi({ stdout: "added", stderr: "", code: 0 });
		piCoasExtension(fake.api);

		await callTool(fake.tools, "coas_schedule_add", {
			room: "test-room",
			name: "daily",
			cron: "0 9 * * *",
			prompt: "summarize",
			workspace: "ops",
		}, makeCtx(cwd));

		expect(fake.execCalls[0]?.args).toEqual([
			`COAS_HOME=${coasHome}`,
			join(coasDir, "scripts", "coas-schedule"),
			"add",
			"--room",
			"test-room",
			"--name",
			"daily",
			"--cron",
			"0 9 * * *",
			"--prompt",
			"summarize",
			"--workspace",
			"ops",
		]);
	});

	it("schedule run defaults to dry-run", async () => {
		const fake = createFakeApi({ stdout: "dry", stderr: "", code: 0 });
		piCoasExtension(fake.api);

		await callTool(fake.tools, "coas_schedule_run", { taskId: "daily" }, makeCtx(cwd));

		expect(fake.execCalls[0]?.args.slice(-3)).toEqual(["run", "daily", "--dry-run"]);
	});
});

describe("pi-coas workspace tools", () => {
	it("lists, reads, and appends workspace context", async () => {
		const workspaceDir = join(coasHome, "workspaces", "ops");
		mkdirSync(join(workspaceDir, ".coas"), { recursive: true });
		writeFileSync(join(workspaceDir, "CONTEXT.md"), "# Ops\n", "utf8");
		writeFileSync(join(workspaceDir, ".coas", "workspace.env"), "WORKSPACE_ID=ops\nPURPOSE='Operations room'\n", "utf8");
		const fake = createFakeApi();
		piCoasExtension(fake.api);

		const list = await callTool(fake.tools, "coas_workspace_list", {}, makeCtx(cwd));
		expect(list.content[0]?.text).toContain("ops");
		expect(list.content[0]?.text).toContain("Operations room");

		const read = await callTool(fake.tools, "coas_workspace_read", { workspace: "ops" }, makeCtx(cwd));
		expect(read.content[0]?.text).toContain("# Ops");

		await callTool(fake.tools, "coas_workspace_update", { workspace: "ops", text: "- stable fact" }, makeCtx(cwd));
		expect(readFileSync(join(workspaceDir, "CONTEXT.md"), "utf8")).toContain("- stable fact");
	});

	it("rejects explicit path selectors outside CoAS workspaces", async () => {
		const outsideDir = join(root, "outside");
		mkdirSync(outsideDir, { recursive: true });
		writeFileSync(join(outsideDir, "CONTEXT.md"), "# Outside\n", "utf8");
		const fake = createFakeApi();
		piCoasExtension(fake.api);

		await expect(callTool(fake.tools, "coas_workspace_read", { workspace: outsideDir }, makeCtx(cwd)))
			.rejects.toThrow(/Workspace path must be under/);
		await expect(callTool(fake.tools, "coas_workspace_update", { workspace: "../outside", text: "bad" }, makeCtx(cwd)))
			.rejects.toThrow(/Workspace path must be under|Invalid workspace id/);
		expect(existsSync(join(outsideDir, "CONTEXT.md"))).toBe(true);
		expect(readFileSync(join(outsideDir, "CONTEXT.md"), "utf8")).toBe("# Outside\n");
	});
});

describe("pi-coas lifecycle", () => {
	it("injects workspace guidance when CONTEXT.md exists in cwd", async () => {
		writeFileSync(join(cwd, "CONTEXT.md"), "# Local\n", "utf8");
		const fake = createFakeApi();
		piCoasExtension(fake.api);
		const handler = fake.handlers.get("before_agent_start");
		if (!handler) throw new Error("before_agent_start not registered");

		const result = await handler({ systemPrompt: "base" }, makeCtx(cwd));

		expect(result).toEqual({
			systemPrompt: expect.stringContaining("coas_workspace_read"),
		});
	});
});
