/**
 * Direct behavior tests for the pi-goal extension.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import goalExtension from "../../extensions/pi-goal/index.js";
import { createFileGoal, loadGoal } from "../../extensions/pi-goal/goal-persist.js";
import { createTextGoal, startRun, updateGoal } from "../../extensions/pi-goal/state.js";

import { writeGoalFixture as saveGoal } from "../fixtures/goal-state.js";

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
	newSession(options?: { withSession?: (ctx: FakeCommandContext) => Promise<void> }): Promise<{ cancelled: boolean }>;
	sendUserMessage(message: string, options?: unknown): Promise<void>;
	hasPendingMessages(): boolean;
	isIdle(): boolean;
}

interface FakeContext {
	readonly cwd: string;
	readonly ui: FakeUi;
	readonly sessionManager: { getSessionFile(): string | undefined };
	hasPendingMessages(): boolean;
	isIdle(): boolean;
	sendUserMessage(message: string, options?: unknown): Promise<void>;
}

interface FakePi {
	readonly commands: Map<string, RegisteredCommand>;
	readonly tools: unknown[];
	readonly sentMessages: SentMessage[];
	readonly handlers: Map<string, unknown[]>;
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

	it("/goal file <path> keeps its source unchanged and starts direct execution", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir, pi);
		pi.sendUserMessage = async () => {
			await triggerAgentEndEvent(pi, ctx as unknown as FakeContext, [{ role: "assistant", stopReason: "aborted", content: "" }]);
		};
		await writeFile(join(tempDir, "goal.txt"), "Ship the file-backed goal.", "utf8");

		await runGoalCommand(pi, "file goal.txt", ctx);

		const persisted = await readInstanceGoal(tempDir);
		expect(persisted).toMatchObject({
			objective: "Complete the work described by goal.txt",
			sourcePath: "goal.txt",
			turnBudget: 0,
			runMode: "continuous",
		});
	});

	it("legacy file start syntax also starts an unbounded direct run", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir, pi);
		pi.sendUserMessage = async () => {
			await triggerAgentEndEvent(pi, ctx as unknown as FakeContext, [{ role: "assistant", stopReason: "aborted", content: "" }]);
		};
		await writeFile(join(tempDir, "goal.txt"), "Ship the requested file-backed goal flow.", "utf8");

		await runGoalCommand(pi, "file goal.txt goal start", ctx);

		const persisted = await readInstanceGoal(tempDir);
		const todo = await readFile(join(tempDir, persisted.sourcePath ?? "goal.txt"), "utf8");
		expect(persisted).toMatchObject({ runActive: false, turnBudget: 0, runMode: "continuous" });
		expect(persisted.sourcePath).toBe("goal.txt");
		expect(todo).toContain("Ship the requested file-backed goal flow.");
	});

	it("rejects direct goal source symlinks that escape the project", async () => {
		const outside = await mkdtemp(join(tmpdir(), "pi-goal-outside-"));
		try {
			await writeFile(join(outside, "secret.txt"), "outside content", "utf8");
			await symlink(join(outside, "secret.txt"), join(tempDir, "goal-link.txt"));

			await expect(createFileGoal(tempDir, "goal-link.txt"))
				.rejects.toThrow("Goal source must not contain symlink components");
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	it("rejects intermediate goal source symlinks before reading outside content", async () => {
		const outside = await mkdtemp(join(tmpdir(), "pi-goal-outside-dir-"));
		try {
			await mkdir(join(outside, "nested"));
			await writeFile(join(outside, "nested", "secret.txt"), "outside content", "utf8");
			await symlink(join(outside, "nested"), join(tempDir, "linked-dir"));

			await expect(createFileGoal(tempDir, "linked-dir/secret.txt"))
				.rejects.toThrow("Goal source must not contain symlink components");
			await expect(readFile(join(tempDir, ".pi", "goal", "TODO.md"), "utf8")).rejects.toThrow();
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
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
			message: "Goal run stopped after 0/3 turns (stop requested). Use /goal run to continue (or --turns N for a bounded run).",
			level: "info",
		});
		expect(ctx.ui.statuses.at(-1)?.key).toBe("goal");
		expect(ctx.ui.statuses.at(-1)?.value).toBe("goal: active");
	});

	it("plain /goal run continues without a turn budget", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir, pi);
		const state = await createTextGoal(tempDir, "default run mode test");
		await saveGoal(tempDir, state);

		let resolveNewSession: ((value: { cancelled: boolean }) => void) | undefined;
		ctx.newSession = () => new Promise((resolve) => {
			resolveNewSession = resolve;
		});
		pi.sendUserMessage = async () => {
			await triggerAgentEndEvent(pi, ctx as unknown as FakeContext, [{ role: "assistant", content: "" }]);
		};

		const runPromise = runGoalCommand(pi, "run", ctx);
		await waitFor(() => resolveNewSession !== undefined);

		const persisted = JSON.parse(await readFile(join(tempDir, ".pi/goal/goal.json"), "utf8")) as {
			turnBudget: number;
			runMode: string;
			runActive: boolean;
		};
		expect(persisted).toMatchObject({
			turnBudget: 0,
			runMode: "continuous",
			runActive: true,
		});

		await runGoalCommand(pi, "pause", ctx);
		resolveNewSession?.({ cancelled: false });
		await triggerAgentEndEvent(pi, ctx as unknown as FakeContext, [{ role: "assistant", content: "" }]);
		await runPromise;
	});

	it("goal_complete clears the footer status and widget on completion", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		const state = startRun(await createTextGoal(tempDir, "complete clears footer"), 5);
		await saveGoal(tempDir, state);

		const tool = pi.tools.find((entry) => {
			return typeof entry === "object" && entry !== null && "name" in entry && entry.name === "goal_complete";
		}) as { execute: (id: string, params: { evidence: string }, signal: unknown, onUpdate: unknown, ctx: FakeCommandContext) => Promise<unknown> } | undefined;
		expect(tool).toBeDefined();
		await tool?.execute("call-1", { evidence: "all tests green" }, undefined, undefined, ctx);

		expect(ctx.ui.statuses.at(-1)).toEqual({ key: "goal", value: undefined });
		expect(ctx.ui.widgets.at(-1)).toEqual({ key: "goal", value: undefined });
		const persisted = JSON.parse(await readFile(join(tempDir, ".pi/goal", "goal.json"), "utf8")) as { status: string; runActive: boolean };
		expect(persisted.status).toBe("complete");
		expect(persisted.runActive).toBe(false);
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
		// Mock pi.sendUserMessage to trigger agent_end so iteration 1 completes.
		pi.sendUserMessage = async () => {
			await triggerAgentEndEvent(pi, ctx as unknown as FakeContext, [{ role: "assistant", content: "" }]);
		};

		const runPromise = runGoalCommand(pi, "goal test loop shutdown", ctx);
		await waitFor(() => resolveNewSession !== undefined);
		await runGoalCommand(pi, "stop", ctx);
		resolveNewSession?.({ cancelled: false });
		await runPromise;

		const persisted = JSON.parse(await readFile(join(tempDir, ".pi/goal", "goal.json"), "utf8")) as {
			runActive: boolean;
			turnsUsed: number;
			turnBudget: number;
			runMode: string;
		};
		expect(persisted).toMatchObject({ runActive: false, turnsUsed: 1, turnBudget: 0, runMode: "continuous" });
	});

	it("session shutdown cancels the watchdog timer", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		const sessionStart = pi.handlers.get("session_start")?.[0] as ((event: unknown, context: FakeContext) => Promise<void>) | undefined;
		const shutdown = pi.handlers.get("session_shutdown");
		expect(sessionStart).toBeDefined();
		const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
		await sessionStart?.({ reason: "startup" }, ctx as unknown as FakeContext);
		const shutdownHandler = pi.handlers.get("session_shutdown")?.[0] as ((event: unknown, context: FakeContext) => Promise<void>) | undefined;
		expect(shutdownHandler).toBeDefined();
		await shutdownHandler?.({ reason: "quit" }, ctx as unknown as FakeContext);
		expect(clearTimeoutSpy).toHaveBeenCalled();
		clearTimeoutSpy.mockRestore();
		expect(shutdown).toHaveLength(1); // Registered once, not nested per session_start.
	});

	it("/goal pause records an interrupted run", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		await saveGoal(tempDir, startRun(await createTextGoal(tempDir, "pause"), 3));
		await runGoalCommand(pi, "pause", ctx);
		const persisted = await loadGoal(tempDir);
		expect(persisted?.status).toBe("paused");
		expect(persisted?.executionState).toBe("interrupted");
		expect(persisted?.runActive).toBe(false);
	});

	it("/goal resume preserves consumed turns and switches to unbounded execution", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir, pi);
		const started = updateGoal(startRun(await createTextGoal(tempDir, "resume accounting"), 5), {
			status: "paused",
			runActive: false,
			turnsUsed: 2,
			executionState: "interrupted",
		});
		await saveGoal(tempDir, started);
		let sends = 0;
		ctx.newSession = async (options) => {
			await options?.withSession?.({ ...ctx, sendUserMessage: async () => {
				sends += 1;
				await triggerAgentEndEvent(pi, ctx, [{ role: "assistant", stopReason: "aborted", content: "" }]);
			} });
			return { cancelled: false };
		};
		pi.sendUserMessage = async () => {
			sends += 1;
			await triggerAgentEndEvent(pi, ctx as unknown as FakeContext, [{ role: "assistant", stopReason: "aborted", content: "" }]);
		};
		await runGoalCommand(pi, "resume", ctx);
		const persisted = await loadGoal(tempDir);
		expect(persisted?.status).toBe("paused");
		expect(persisted?.turnsUsed).toBe(2);
		expect(persisted?.turnBudget).toBe(0);
		expect(persisted?.runId).not.toBe(started.runId);
		expect(sends).toBeGreaterThan(0);
	});

	it("/goal steer bounds persisted and injected guidance to 400 characters", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		const state = startRun(await createTextGoal(tempDir, "steer bound"), 3);
		await saveGoal(tempDir, state);
		const guidance = "x".repeat(800);
		let injected = "";
		pi.sendUserMessage = (message) => {
			injected = message;
		};
		await runGoalCommand(pi, `steer ${guidance}`, ctx);
		expect(injected.endsWith("x".repeat(400))).toBe(true);
		expect((await loadGoal(tempDir))?.steeringContext).toBe("x".repeat(400));
	});

	it("pauses an active run when the turn budget is exhausted", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		const state = updateGoal(startRun(await createTextGoal(tempDir, "budget stop"), 1), { turnsUsed: 0 });
		await saveGoal(tempDir, state);
		pi.sendUserMessage = () => { void triggerAgentEndEvent(pi, ctx, [{ role: "assistant", content: "finished" }]); };
		await runGoalCommand(pi, "stop", ctx);
		await runGoalCommand(pi, "run --turns 1", ctx);
		const persisted = await loadGoal(tempDir);
		expect(persisted?.runActive).toBe(false);
		expect(persisted?.turnsUsed).toBe(1);
		expect(persisted?.lastError).toContain("budget");
	});

	it("/goal edit updates the objective without resetting counters", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		const state = updateGoal(startRun(await createTextGoal(tempDir, "original objective"), 5), { turnsUsed: 2 });
		await saveGoal(tempDir, state);

		await runGoalCommand(pi, "edit revised objective text", ctx);

		const persisted = JSON.parse(await readFile(join(tempDir, ".pi/goal", "goal.json"), "utf8")) as {
			objective: string;
			turnsUsed: number;
			turnBudget: number;
		};
		expect(persisted.objective).toBe("revised objective text");
		expect(persisted.turnsUsed).toBe(2);
		expect(persisted.turnBudget).toBe(5);
		expect(ctx.ui.notifications).toContainEqual({ message: "Goal updated. Use /goal run to continue direct execution.", level: "info" });
		expect(ctx.ui.widgets.at(-1)?.value).toEqual(["goal: running 2/5 · /goal status for details"]);
	});

	it("continuation marker guard swallows cancelled extension input", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir, pi);
		const state = await createTextGoal(tempDir, "marker test");
		await saveGoal(tempDir, state);

		// Start a run so a marker gets registered, then pause to cancel it.
		let resolveNewSession: ((value: { cancelled: boolean }) => void) | undefined;
		ctx.newSession = () => new Promise((resolve) => {
			resolveNewSession = resolve;
		});
		pi.sendUserMessage = async () => {
			await triggerAgentEndEvent(pi, ctx as unknown as FakeContext, [{ role: "assistant", content: "" }]);
		};

		const runPromise = runGoalCommand(pi, "run", ctx);
		await waitFor(() => resolveNewSession !== undefined);
		await runGoalCommand(pi, "pause", ctx);
		resolveNewSession?.({ cancelled: false });
		await triggerAgentEndEvent(pi, ctx as unknown as FakeContext, [{ role: "assistant", content: "" }]);
		await runPromise;

		// Now trigger the input event with the cancelled marker.
		const result = await triggerInputEvent(pi, "extension", `Continue <!-- pi-goal-continuation:${state.goalId}:2 -->`);
		expect(result).toEqual({ action: "handled" });

		// An unrelated extension input should not be handled.
		const unrelated = await triggerInputEvent(pi, "extension", "Some unrelated prompt");
		expect(unrelated).toBeUndefined();
	});

	it("auto-pause on agent_end with stopReason error", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		const state = startRun(await createTextGoal(tempDir, "auto pause test"), 5);
		await saveGoal(tempDir, state);

		pi.sendUserMessage = () => { void triggerAgentEndEvent(pi, ctx, [{ role: "assistant", stopReason: "error", content: "oops" }]); };
		await runGoalCommand(pi, "stop", ctx);
		await runGoalCommand(pi, "run --turns 5", ctx);

		const persisted = JSON.parse(await readFile(join(tempDir, ".pi/goal", "goal.json"), "utf8")) as {
			status: string;
			runActive: boolean;
		};
		expect(persisted.status).toBe("paused");
		expect(persisted.runActive).toBe(false);
		expect(ctx.ui.notifications).toContainEqual({
			message: "Goal paused after interruption/agent error. Run /goal resume to continue.",
			level: "info",
		});
	});

	it("auto-pause on agent_end with stopReason aborted", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		const state = startRun(await createTextGoal(tempDir, "auto pause aborted"), 5);
		await saveGoal(tempDir, state);

		pi.sendUserMessage = () => { void triggerAgentEndEvent(pi, ctx, [{ role: "assistant", stopReason: "aborted", content: "" }]); };
		await runGoalCommand(pi, "stop", ctx);
		await runGoalCommand(pi, "run --turns 5", ctx);

		const persisted = JSON.parse(await readFile(join(tempDir, ".pi/goal", "goal.json"), "utf8")) as {
			status: string;
			runActive: boolean;
		};
		expect(persisted.status).toBe("paused");
		expect(persisted.runActive).toBe(false);
	});

	it("first turn of a run uses current session (sendUserMessage), second uses newSession", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir, pi);
		const state = await createTextGoal(tempDir, "session routing test");
		await saveGoal(tempDir, state);

		const sendUserMessageCalls: string[] = [];
		let resolveNewSession: ((value: { cancelled: boolean }) => void) | undefined;
		pi.sendUserMessage = async (message) => {
			sendUserMessageCalls.push(message);
			await triggerAgentEndEvent(pi, ctx as unknown as FakeContext, [{ role: "assistant", content: "" }]);
		};
		ctx.newSession = () =>
			new Promise((resolve) => {
				resolveNewSession = resolve;
			});

		const runPromise = runGoalCommand(pi, "run --turns 2", ctx);
		await waitFor(() => resolveNewSession !== undefined);

		// Iteration 1 should have used sendUserMessage in the current session.
		expect(sendUserMessageCalls.length).toBe(1);
		expect(sendUserMessageCalls[0]).toContain("session routing test");
		expect(sendUserMessageCalls[0]).not.toContain("pi-goal-continuation:");

		// Resolve iteration 2 so the loop can finish.
		resolveNewSession?.({ cancelled: false });
		await triggerAgentEndEvent(pi, ctx as unknown as FakeContext, [{ role: "assistant", content: "" }]);
		await runPromise;
	});
});

function createFakePi(): FakePi {
	const commands = new Map<string, RegisteredCommand>();
	const tools: unknown[] = [];
	const sentMessages: SentMessage[] = [];
	const handlers = new Map<string, unknown[]>();
	return {
		commands,
		tools,
		sentMessages,
		handlers,
		registerCommand(name, command) {
			commands.set(name, command);
		},
		registerTool(tool) {
			tools.push(tool);
		},
		on(eventName, handler) {
			handlers.set(eventName, [...(handlers.get(eventName) ?? []), handler]);
		},
		sendMessage(message, options) {
			sentMessages.push({ message, options });
		},
		sendUserMessage() {},
	};
}

function createFakeContext(cwd: string, pi?: FakePi): FakeCommandContext {
	const ctx: FakeCommandContext = {
		cwd,
		ui: createFakeUi(),
		async waitForIdle() {},
		sessionManager: { getSessionFile: () => undefined },
		async newSession() {
			return { cancelled: true };
		},
		async sendUserMessage() {},
		hasPendingMessages: () => false,
		isIdle: () => true,
	};
	if (pi) {
		ctx.sendUserMessage = async () => {
			await triggerAgentEndEvent(pi, ctx as unknown as FakeContext, [{ role: "assistant", content: "" }]);
		};
		ctx.newSession = async (options) => {
			await options?.withSession?.(ctx);
			return { cancelled: false };
		};
	}
	return ctx;
}

async function triggerInputEvent(pi: FakePi, source: string, text: string): Promise<unknown> {
	const eventHandlers = pi.handlers.get("input") ?? [];
	for (const handler of eventHandlers) {
		const result = await (handler as (event: { source: string; text: string }) => Promise<unknown> | unknown)({ source, text });
		if (result !== undefined) return result;
	}
	return undefined;
}

async function triggerAgentEndEvent(pi: FakePi, ctx: FakeContext, messages: unknown[]): Promise<void> {
	const eventHandlers = pi.handlers.get("agent_end") ?? [];
	for (const handler of eventHandlers) {
		await (handler as (event: { messages: unknown[] }, ctx: FakeContext) => Promise<void>)({ messages }, ctx);
	}
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

async function readInstanceGoal(cwd: string): Promise<{ readonly goalId: string; readonly objective: string; readonly sourcePath?: string; readonly runActive: boolean; readonly turnBudget: number }> {
	let path = join(cwd, ".pi/goal", "goal.json");
	try {
		const instanceIds = await readdir(join(cwd, ".pi/goal/instances"));
		expect(instanceIds).toHaveLength(1);
		const goalId = instanceIds[0];
		if (goalId === undefined) throw new Error("Expected one goal instance");
		path = join(cwd, ".pi/goal", "instances", goalId, "goal.json");
	} catch (error) {
		if (!(error instanceof Error) || !error.message.includes("ENOENT")) throw error;
	}
	return JSON.parse(await readFile(path, "utf8")) as {
		readonly goalId: string;
		readonly objective: string;
		readonly sourcePath?: string;
		readonly runActive: boolean;
		readonly turnBudget: number;
	};
}

async function runGoalCommand(pi: FakePi, args: string, ctx: FakeCommandContext): Promise<void> {
	const command = pi.commands.get("goal");
	expect(command).toBeDefined();
	await command?.handler(args, ctx);
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 1_000;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
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
