/**
 * Direct behavior tests for the pi-goal extension.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import goalExtension from "../../extensions/pi-goal/index.js";
import { createTextGoal, saveGoal, startRun } from "../../extensions/pi-goal/state.js";

interface RegisteredCommand {
	readonly description: string;
	readonly handler: (args: string, ctx: FakeCommandContext) => Promise<void>;
}

interface SentMessage {
	readonly message: unknown;
	readonly options?: unknown;
}

interface FakeUi {
	readonly statuses: Array<{ key: string; value: string | undefined }>;
	readonly widgets: Array<{ key: string; value: string[] | undefined }>;
	readonly notifications: Array<{ message: string; level: string }>;
	setStatus(key: string, value: string | undefined): void;
	setWidget(key: string, value: string[] | undefined): void;
	notify(message: string, level: string): void;
}

interface FakeCommandContext {
	readonly cwd: string;
	readonly ui: FakeUi;
	waitForIdle(): Promise<void>;
	readonly sessionManager: { getSessionFile(): string | undefined };
	newSession(): Promise<{ cancelled: boolean }>;
	sendUserMessage(message: string): Promise<void>;
}

interface FakePi {
	readonly commands: Map<string, RegisteredCommand>;
	readonly tools: unknown[];
	readonly sentMessages: SentMessage[];
	registerCommand(name: string, command: RegisteredCommand): void;
	registerTool(tool: unknown): void;
	on(eventName: string, handler: unknown): void;
	sendMessage(message: unknown, options?: unknown): void;
	sendUserMessage(message: string, options?: unknown): void;
}

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "pi-goal-test-"));
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe("pi-goal extension", () => {
	it("registers the goal command and tools", () => {
		const pi = createFakePi();

		goalExtension(pi as unknown as ExtensionAPI);

		expect(pi.commands.has("goal")).toBe(true);
		expect(toolNames(pi.tools)).toEqual(["goal_get", "goal_complete"]);
	});

	it("/goal with no args shows command help", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);

		await runGoalCommand(pi, "", ctx);

		expect(sentMessageContent(pi)).toContain("# pi-goal commands");
		expect(sentMessageContent(pi)).toContain("/goal clear");
	});

	it("/goal help shows command help", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);

		await runGoalCommand(pi, "help", ctx);

		expect(sentMessageContent(pi)).toContain("/goal status");
		expect(sentMessageContent(pi)).toContain("/goal file <path>");
	});

	it("unknown option-style goal commands show help without creating a goal", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);

		await runGoalCommand(pi, "--bogus", ctx);

		expect(ctx.ui.notifications).toContainEqual({
			message: "Unknown /goal option: --bogus. Use /goal help.",
			level: "warning",
		});
		expect(sentMessageContent(pi)).toContain("# pi-goal commands");
		await expect(readFile(join(tempDir, ".pi/goal", "goal.json"), "utf8")).rejects.toThrow();
	});

	it("/goal file <path> goal start creates a TODO and starts a 20-turn run", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		await writeFile(join(tempDir, "goal.txt"), "Ship the requested file-backed goal flow.", "utf8");

		await runGoalCommand(pi, "file goal.txt goal start", ctx);

		const persisted = JSON.parse(await readFile(join(tempDir, ".pi/goal", "goal.json"), "utf8")) as {
			runActive: boolean;
			turnBudget: number;
			sourcePath: string;
		};
		const todo = await readFile(join(tempDir, ".pi/goal", "TODO.md"), "utf8");
		expect(persisted).toMatchObject({ runActive: true, turnBudget: 20, sourcePath: ".pi/goal/TODO.md" });
		expect(todo).toContain("Ship the requested file-backed goal flow.");
	});

	it("/goal stop shuts down the active run immediately", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		const state = startRun(await createTextGoal(tempDir, "test stop behavior"), 3);
		await saveGoal(tempDir, state);

		await runGoalCommand(pi, "stop", ctx);

		const persisted = JSON.parse(await readFile(join(tempDir, ".pi/goal", "goal.json"), "utf8")) as { runActive: boolean };
		expect(persisted.runActive).toBe(false);
		expect(ctx.ui.notifications).toContainEqual({
			message: "Goal run stopped after 0/3 turns (stop requested). Use /goal run --turns N to continue.",
			level: "info",
		});
		expect(ctx.ui.statuses.at(-1)?.key).toBe("goal");
	expect(ctx.ui.statuses.at(-1)?.value).toMatch(/^goal: active( \[\ds\])?$/);
	});

	it("/goal clear explains local state removal", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		const state = await createTextGoal(tempDir, "clear behavior");
		await saveGoal(tempDir, state);

		await runGoalCommand(pi, "clear", ctx);

		expect(ctx.ui.notifications).toContainEqual({
			message: "Goal cleared: removed .pi/goal/ state, TODO, summary, and local run transcripts for this workspace.",
			level: "info",
		});
		await expect(readFile(join(tempDir, ".pi/goal", "goal.json"), "utf8")).rejects.toThrow();
	});

	it("/goal stop resolves a waiting goal loop", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		let resolveNewSession: ((value: { cancelled: boolean }) => void) | undefined;
		ctx.newSession = () => new Promise((resolve) => {
			resolveNewSession = resolve;
		});

		const runPromise = runGoalCommand(pi, "goal test loop shutdown", ctx);
		await waitFor(() => resolveNewSession !== undefined);
		await runGoalCommand(pi, "stop", ctx);
		resolveNewSession?.({ cancelled: false });
		await runPromise;

		const persisted = JSON.parse(await readFile(join(tempDir, ".pi/goal", "goal.json"), "utf8")) as { runActive: boolean; turnsUsed: number };
		expect(persisted).toMatchObject({ runActive: false, turnsUsed: 0 });
	});
});

function createFakePi(): FakePi {
	const commands = new Map<string, RegisteredCommand>();
	const tools: unknown[] = [];
	const sentMessages: SentMessage[] = [];
	return {
		commands,
		tools,
		sentMessages,
		registerCommand(name, command) {
			commands.set(name, command);
		},
		registerTool(tool) {
			tools.push(tool);
		},
		on() {},
		sendMessage(message, options) {
			sentMessages.push({ message, options });
		},
		sendUserMessage() {},
	};
}

function createFakeContext(cwd: string): FakeCommandContext {
	return {
		cwd,
		ui: createFakeUi(),
		async waitForIdle() {},
		sessionManager: { getSessionFile: () => undefined },
		async newSession() {
			return { cancelled: true };
		},
		async sendUserMessage() {},
	};
}

function createFakeUi(): FakeUi {
	const statuses: Array<{ key: string; value: string | undefined }> = [];
	const widgets: Array<{ key: string; value: string[] | undefined }> = [];
	const notifications: Array<{ message: string; level: string }> = [];
	return {
		statuses,
		widgets,
		notifications,
		setStatus(key, value) {
			statuses.push({ key, value });
		},
		setWidget(key, value) {
			widgets.push({ key, value });
		},
		notify(message, level) {
			notifications.push({ message, level });
		},
	};
}

async function runGoalCommand(pi: FakePi, args: string, ctx: FakeCommandContext): Promise<void> {
	const command = pi.commands.get("goal");
	expect(command).toBeDefined();
	await command?.handler(args, ctx);
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let i = 0; i < 20; i++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Timed out waiting for condition");
}

function sentMessageContent(pi: FakePi): string {
	const message = pi.sentMessages.at(-1)?.message;
	if (typeof message === "object" && message !== null && "content" in message && typeof message.content === "string") {
		return message.content;
	}
	return "";
}

function toolNames(tools: unknown[]): string[] {
	return tools.map((tool) => {
		if (typeof tool === "object" && tool !== null && "name" in tool && typeof tool.name === "string") {
			return tool.name;
		}
		return "";
	});
}
