/**
 * Tests for the pi-coas TypeScript runtime extension.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function createFakeApi() {
	const tools = new Map<string, RegisteredTool>();
	const commands = new Map<string, RegisteredCommand>();
	const handlers = new Map<string, RegisteredHandler>();
	const api = {
		registerTool(def: RegisteredTool) { tools.set(def.name, def); },
		registerCommand(name: string, opts: RegisteredCommand) { commands.set(name, opts); },
		registerShortcut(_key: string, _opts: unknown) { /* no-op */ },
		registerFlag(_name: string, _opts: unknown) { /* no-op */ },
		on(event: string, handler: RegisteredHandler) { handlers.set(event, handler); },
		getFlag(_name: string) { return undefined; },
		sendUserMessage(_message: string, _options?: unknown) { /* no-op */ },
		exec(_command: string, _args: string[]) {
			throw new Error("pi-coas TypeScript runtime must not shell out");
		},
	};
	return { api: api as unknown as ExtensionAPI, tools, commands, handlers };
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

function textOf(result: ToolResult): string {
	return result.content.map((part) => part.text).join("\n");
}

let root: string;
let coasHome: string;
let cwd: string;
let oldCoasHome: string | undefined;
let oldCoasDir: string | undefined;
let oldWorkspaceId: string | undefined;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pi-coas-test-"));
	coasHome = join(root, "coas-home");
	cwd = join(root, "project");
	mkdirSync(coasHome, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	oldCoasHome = process.env.COAS_HOME;
	oldCoasDir = process.env.COAS_DIR;
	oldWorkspaceId = process.env.COAS_WORKSPACE_ID;
	process.env.COAS_HOME = coasHome;
	process.env.COAS_DIR = join(root, "missing-coas-checkout");
	delete process.env.COAS_WORKSPACE_ID;
});

afterEach(() => {
	if (oldCoasHome === undefined) delete process.env.COAS_HOME;
	else process.env.COAS_HOME = oldCoasHome;
	if (oldCoasDir === undefined) delete process.env.COAS_DIR;
	else process.env.COAS_DIR = oldCoasDir;
	if (oldWorkspaceId === undefined) delete process.env.COAS_WORKSPACE_ID;
	else process.env.COAS_WORKSPACE_ID = oldWorkspaceId;
	rmSync(root, { recursive: true, force: true });
});

describe("pi-coas TypeScript runtime tools", () => {
	it("reports status and doctor output without external CoAS scripts", async () => {
		const fake = createFakeApi();
		piCoasExtension(fake.api);

		const status = await callTool(fake.tools, "coas_status", {}, makeCtx(cwd));
		const doctor = await callTool(fake.tools, "coas_doctor", {}, makeCtx(cwd));

		expect(textOf(status)).toContain(coasHome);
		expect(textOf(status)).not.toContain("~/git/coas");
		expect(textOf(doctor)).toContain("CoAS doctor");
	});
});

describe("pi-coas workspace tools", () => {
	it("creates, lists, reads, and appends workspace context", async () => {
		const fake = createFakeApi();
		piCoasExtension(fake.api);

		const created = await callTool(fake.tools, "coas_workspace_create", {
			room: "!room:example",
			workspace: "Ops Room",
			purpose: "Operations room",
		}, makeCtx(cwd));
		expect(textOf(created)).toContain("ops-room");

		const list = await callTool(fake.tools, "coas_workspace_list", {}, makeCtx(cwd));
		expect(textOf(list)).toContain("ops-room");
		expect(textOf(list)).toContain("Operations room");

		const read = await callTool(fake.tools, "coas_workspace_read", { workspace: "ops-room" }, makeCtx(cwd));
		expect(textOf(read)).toContain("# CoAS Workspace: ops-room");

		await callTool(fake.tools, "coas_workspace_update", { workspace: "ops-room", text: "- stable fact" }, makeCtx(cwd));
		expect(readFileSync(join(coasHome, "workspaces", "ops-room", "CONTEXT.md"), "utf8")).toContain("- stable fact");
	});

	it("rejects explicit and default workspace paths outside real CoAS workspaces", async () => {
		const outsideDir = join(root, "outside");
		mkdirSync(outsideDir, { recursive: true });
		writeFileSync(join(outsideDir, "CONTEXT.md"), "# Outside\n", "utf8");
		const fake = createFakeApi();
		piCoasExtension(fake.api);

		await expect(callTool(fake.tools, "coas_workspace_read", { workspace: outsideDir }, makeCtx(cwd)))
			.rejects.toThrow(/Workspace path must be under/);
		await expect(callTool(fake.tools, "coas_workspace_update", { text: "bad" }, makeCtx(outsideDir)))
			.rejects.toThrow(/Workspace path must be under/);
		expect(readFileSync(join(outsideDir, "CONTEXT.md"), "utf8")).toBe("# Outside\n");
	});

	it("rejects symlinks inside workspace roots", async () => {
		const workspaceDir = join(coasHome, "workspaces", "ops");
		mkdirSync(join(workspaceDir, ".coas"), { recursive: true });
		writeFileSync(join(workspaceDir, ".coas", "workspace.env"), "WORKSPACE_ID=ops\n", "utf8");
		writeFileSync(join(root, "target.md"), "secret\n", "utf8");
		symlinkSync(join(root, "target.md"), join(workspaceDir, "CONTEXT.md"));
		const fake = createFakeApi();
		piCoasExtension(fake.api);

		await expect(callTool(fake.tools, "coas_workspace_update", { workspace: "ops", text: "bad" }, makeCtx(cwd)))
			.rejects.toThrow(/symlink/);

		const linkedWorkspace = join(coasHome, "workspaces", "linked");
		symlinkSync(root, linkedWorkspace);
		await expect(callTool(fake.tools, "coas_workspace_update", { workspace: linkedWorkspace, text: "bad" }, makeCtx(cwd)))
			.rejects.toThrow(/symlink/);
	});
});

describe("pi-coas schedule tools", () => {
	it("adds, lists, dry-runs, refuses execution, and removes schedules", async () => {
		const fake = createFakeApi();
		piCoasExtension(fake.api);

		const added = await callTool(fake.tools, "coas_schedule_add", {
			room: "!room:example",
			name: "Daily Summary",
			cron: "0 9 * * *",
			prompt: "summarize",
			workspace: "ops",
		}, makeCtx(cwd));
		expect(textOf(added)).toContain("daily-summary");

		const list = await callTool(fake.tools, "coas_schedule_list", {}, makeCtx(cwd));
		expect(textOf(list)).toContain("daily-summary");
		expect(textOf(list)).toContain("0 9 * * *");

		const dryRun = await callTool(fake.tools, "coas_schedule_run", { taskId: "daily-summary" }, makeCtx(cwd));
		expect(textOf(dryRun)).toContain("dry-run only");
		expect(textOf(dryRun)).toContain("summarize");

		const run = await callTool(fake.tools, "coas_schedule_run", { taskId: "daily-summary", dryRun: false }, makeCtx(cwd));
		expect(run.details.code).toBe(1);
		expect(textOf(run)).toContain("execution is disabled");

		await callTool(fake.tools, "coas_schedule_remove", { taskId: "daily-summary" }, makeCtx(cwd));
		expect(existsSync(join(coasHome, "schedules", "daily-summary.env"))).toBe(false);
	});

	it("rejects schedule prompt paths outside the schedule registry", async () => {
		mkdirSync(join(coasHome, "schedules"), { recursive: true });
		writeFileSync(join(coasHome, "schedules", "bad.env"), [
			"TASK_ID=bad",
			"TASK_NAME=bad",
			"ROOM_ID=room",
			"WORKSPACE_ID=ops",
			"CRON_EXPR='0 9 * * *'",
			"ENABLED=1",
			`PROMPT_FILE=${join(root, "outside.prompt")}`,
			"",
		].join("\n"), "utf8");
		writeFileSync(join(root, "outside.prompt"), "do not read\n", "utf8");
		const fake = createFakeApi();
		piCoasExtension(fake.api);

		await expect(callTool(fake.tools, "coas_schedule_list", {}, makeCtx(cwd)))
			.rejects.toThrow(/Path escapes/);
		const doctor = await callTool(fake.tools, "coas_doctor", {}, makeCtx(cwd));
		expect(textOf(doctor)).toContain("invalid schedule bad");
	});

	it("rejects unsafe workspace ids in existing schedule metadata", async () => {
		mkdirSync(join(coasHome, "schedules"), { recursive: true });
		writeFileSync(join(coasHome, "schedules", "bad.env"), [
			"TASK_ID=bad",
			"TASK_NAME=bad",
			"ROOM_ID=room",
			"WORKSPACE_ID='../escape'",
			"CRON_EXPR='0 9 * * *'",
			"ENABLED=1",
			`PROMPT_FILE=${join(coasHome, "schedules", "bad.prompt")}`,
			"",
		].join("\n"), "utf8");
		writeFileSync(join(coasHome, "schedules", "bad.prompt"), "do not run\n", "utf8");
		const fake = createFakeApi();
		piCoasExtension(fake.api);

		await expect(callTool(fake.tools, "coas_schedule_list", {}, makeCtx(cwd)))
			.rejects.toThrow(/Invalid workspace id/);
		const doctor = await callTool(fake.tools, "coas_doctor", {}, makeCtx(cwd));
		expect(textOf(doctor)).toContain("invalid schedule bad");
	});
});

describe("pi-coas lifecycle", () => {
	it("injects workspace guidance only for real CoAS workspaces", async () => {
		const fake = createFakeApi();
		piCoasExtension(fake.api);
		const handler = fake.handlers.get("before_agent_start");
		if (!handler) throw new Error("before_agent_start not registered");

		const noWorkspace = await handler({ systemPrompt: "base" }, makeCtx(cwd));
		expect(noWorkspace).toBeUndefined();

		const workspaceDir = join(coasHome, "workspaces", "ops");
		mkdirSync(join(workspaceDir, ".coas"), { recursive: true });
		writeFileSync(join(workspaceDir, ".coas", "workspace.env"), "WORKSPACE_ID=ops\n", "utf8");
		writeFileSync(join(workspaceDir, "CONTEXT.md"), "# Ops\n", "utf8");
		const result = await handler({ systemPrompt: "base" }, makeCtx(workspaceDir));

		expect(result).toEqual({
			systemPrompt: expect.stringContaining("coas_workspace_read"),
		});
	});
});
