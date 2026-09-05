/** T-886 baseline regressions: these tests intentionally fail against the current pi-goal runtime. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as goalPersistence from "../../extensions/pi-goal/goal-persist.js";
import { parseCommand } from "../../extensions/pi-goal/goal-helpers.js";
import { loadGoal } from "../../extensions/pi-goal/goal-persist.js";
import { runGoalLoop } from "../../extensions/pi-goal/goal-run-loop.js";
import type { GoalRuntime } from "../../extensions/pi-goal/goal-runtime.js";
import goalExtension from "../../extensions/pi-goal/index.js";
import {
	createTextGoal,
	startRun,
	updateGoal,
} from "../../extensions/pi-goal/state.js";

import { writeGoalFixture as saveGoal } from "../fixtures/goal-state.js";

const directories: string[] = [];

afterEach(async () => {
	for (const directory of directories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

describe("T-886 pi-goal baseline regressions", () => {
	it("maps the approved continue alias without changing ordinary objective syntax", () => {
		expect(parseCommand("continue")).toMatchObject({ action: "resume" });
		expect(parseCommand("continue improving the parser")).toEqual({
			action: "goal",
			rest: "continue improving the parser",
		});
	});

	it("fails closed when the run driver's initial send throws synchronously", async () => {
		const cwd = await temporaryDirectory();
		const state = startRun(
			await createTextGoal(cwd, "driver error"),
			1,
			"continuous",
		);
		await saveGoal(cwd, state);
		const runtime = createRuntime();
		const context = createCommandContext(cwd);
		const pi = {
			sendUserMessage: () => {
				throw new Error("provider transport failed");
			},
		} as unknown as ExtensionAPI;

		await expect(
			runGoalLoop(pi, runtime, context, state),
		).resolves.toBeUndefined();
		expect((await loadGoal(cwd))?.runActive).toBe(false);
		expect((await loadGoal(cwd))?.lastError).toBe("provider transport failed");
		expect(runtime.resolve).toBeNull();
		expect(runtime.pendingMarker).toBeNull();
	});

	it("normalizes and redacts runtime diagnostics with a safe fallback", async () => {
		const cwd = await temporaryDirectory();
		const state = startRun(
			await createTextGoal(cwd, "diagnostic safety"),
			1,
			"continuous",
		);
		await saveGoal(cwd, state);
		const runtime = createRuntime();
		const context = createCommandContext(cwd);
		const pi = {
			sendUserMessage: () => {
				throw new Error("token=super-secret\n\u001b[31mprovider failed");
			},
		} as unknown as ExtensionAPI;

		await expect(
			runGoalLoop(pi, runtime, context, state),
		).resolves.toBeUndefined();
		expect((await loadGoal(cwd))?.lastError).toBe(
			"token=[REDACTED] provider failed",
		);

		const fallbackState = startRun(
			await createTextGoal(cwd, "diagnostic fallback"),
			1,
			"continuous",
		);
		await saveGoal(cwd, fallbackState);
		const fallbackRuntime = createRuntime();
		const fallbackPi = {
			sendUserMessage: () => {
				throw { provider: "secret-bearing failure" };
			},
		} as unknown as ExtensionAPI;
		await expect(
			runGoalLoop(fallbackPi, fallbackRuntime, context, fallbackState),
		).resolves.toBeUndefined();
		expect((await loadGoal(cwd))?.lastError).toBe("Goal runtime failed.");
	});

	it("settles the waiter but does not claim a pause when containment persistence fails", async () => {
		const cwd = await temporaryDirectory();
		const state = startRun(
			await createTextGoal(cwd, "persistence failure"),
			1,
			"continuous",
		);
		await saveGoal(cwd, state);
		const runtime = createRuntime();
		const transactionSpy = vi
			.spyOn(goalPersistence, "transactGoal")
			.mockRejectedValueOnce(new Error("state write unavailable"));
		const pi = {
			sendUserMessage: () => {
				throw new Error("initial send failed");
			},
		} as unknown as ExtensionAPI;

		await expect(
			runGoalLoop(pi, runtime, createCommandContext(cwd), state),
		).rejects.toThrow("state write unavailable");
		expect(runtime.resolve).toBeNull();
		expect((await loadGoal(cwd))?.runActive).toBe(true);
		transactionSpy.mockRestore();
	});

	it("surfaces UI failure after authoritative containment persistence", async () => {
		const cwd = await temporaryDirectory();
		const state = startRun(
			await createTextGoal(cwd, "UI failure"),
			1,
			"continuous",
		);
		await saveGoal(cwd, state);
		const context = createCommandContext(cwd);
		context.ui.setStatus = () => {
			throw new Error("status refresh unavailable");
		};
		const pi = {
			sendUserMessage: () => {
				throw new Error("initial send failed");
			},
		} as unknown as ExtensionAPI;

		await expect(
			runGoalLoop(pi, createRuntime(), context, state),
		).rejects.toThrow("status refresh unavailable");
		expect((await loadGoal(cwd))?.runActive).toBe(false);
	});

	it("contains waitForIdle failure as an interrupted recoverable run", async () => {
		const cwd = await temporaryDirectory();
		const state = startRun(
			await createTextGoal(cwd, "idle failure"),
			1,
			"continuous",
		);
		await saveGoal(cwd, state);
		const context = createCommandContext(cwd, {
			waitForIdle: async () => {
				throw new Error("idle wait failed");
			},
		});

		await expect(
			runGoalLoop({} as ExtensionAPI, createRuntime(), context, state),
		).resolves.toBeUndefined();
		expect((await loadGoal(cwd))?.runActive).toBe(false);
		expect((await loadGoal(cwd))?.lastError).toBe("idle wait failed");
	});

	it("contains newSession failure as an interrupted recoverable run", async () => {
		const cwd = await temporaryDirectory();
		const state = updateGoal(
			startRun(await createTextGoal(cwd, "session failure"), 2, "continuous"),
			{ turnsUsed: 1 },
		);
		await saveGoal(cwd, state);
		const context = createCommandContext(cwd, {
			newSession: async () => {
				throw new Error("session replacement failed");
			},
		});

		await expect(
			runGoalLoop({} as ExtensionAPI, createRuntime(), context, state),
		).resolves.toBeUndefined();
		expect((await loadGoal(cwd))?.runActive).toBe(false);
		expect((await loadGoal(cwd))?.lastError).toBe("session replacement failed");
	});

	it("reserves replacement ownership before starting a new session", async () => {
		const cwd = await temporaryDirectory();
		const state = updateGoal(startRun(await createTextGoal(cwd, "replacement reservation"), 2, "continuous"), { turnsUsed: 1 });
		await saveGoal(cwd, state);
		let release: (() => void) | undefined;
		const context = createCommandContext(cwd, {
			newSession: async () => {
				const persisted = await loadGoal(cwd);
				expect(persisted?.replacement?.attempt).toBe(2);
				await new Promise<void>((resolve) => { release = resolve; });
				return { cancelled: true };
			},
		});
		const running = runGoalLoop({} as ExtensionAPI, createRuntime(), context, state);
		await vi.waitFor(async () => expect((await loadGoal(cwd))?.replacement).toBeDefined());
		release?.();
		await running;
	});

	it("does not send a replacement turn after cancellation during handoff", async () => {
		const cwd = await temporaryDirectory();
		const state = updateGoal(startRun(await createTextGoal(cwd, "replacement cancellation"), 2, "continuous"), { turnsUsed: 1 });
		await saveGoal(cwd, state);
		const runtime = createRuntime();
		let sends = 0;
		const context = createCommandContext(cwd, {
			newSession: async (options) => {
				runtime.stopRequested = true;
				await options?.withSession?.({
					...createCommandContext(cwd),
					sendUserMessage: async () => {
						sends += 1;
						runtime.resolve?.([]);
					},
				} as never);
				return { cancelled: false };
			},
		});
		await runGoalLoop({} as ExtensionAPI, runtime, context, state);
		expect(sends).toBe(0);
	});

	it("contains replacement-session send rejection as an interrupted recoverable run", async () => {
		const cwd = await temporaryDirectory();
		const state = updateGoal(
			startRun(
				await createTextGoal(cwd, "replacement send failure"),
				2,
				"continuous",
			),
			{ turnsUsed: 1 },
		);
		await saveGoal(cwd, state);
		const context = createCommandContext(cwd, {
			newSession: async (options) => {
				await options?.withSession?.({
					...createCommandContext(cwd),
					sendUserMessage: async () => {
						throw new Error("replacement send failed");
					},
				} as never);
				return { cancelled: false };
			},
		});

		await expect(
			runGoalLoop({} as ExtensionAPI, createRuntime(), context, state),
		).resolves.toBeUndefined();
		expect((await loadGoal(cwd))?.runActive).toBe(false);
		expect((await loadGoal(cwd))?.lastError).toBe("replacement send failed");
	});

	it("prevents two independent drivers from steering one persisted goal", async () => {
		const cwd = await temporaryDirectory();
		const state = startRun(
			await createTextGoal(cwd, "single driver"),
			1,
			"continuous",
		);
		await saveGoal(cwd, state);
		const first = createRuntime();
		const second = createRuntime();
		let sends = 0;
		const makePi = (runtime: GoalRuntime): ExtensionAPI =>
			({
				sendUserMessage: async () => {
					sends += 1;
					runtime.resolve?.([]);
				},
			}) as unknown as ExtensionAPI;

		await Promise.all([
			runGoalLoop(makePi(first), first, createCommandContext(cwd), state),
			runGoalLoop(makePi(second), second, createCommandContext(cwd), state),
		]);

		expect(sends).toBe(1);
	});

	it("contains a failed /goal steer delivery instead of leaving the run active", async () => {
		const cwd = await temporaryDirectory();
		const state = startRun(
			await createTextGoal(cwd, "steering error"),
			2,
			"continuous",
		);
		await saveGoal(cwd, state);
		const pi = createCommandApi(() => {
			throw new Error("steering delivery failed");
		});
		const context = createCommandContext(cwd);
		goalExtension(pi as unknown as ExtensionAPI);

		await expect(
			pi.commands.get("goal")?.handler("steer use the safe path", context),
		).resolves.toBeUndefined();
		expect((await loadGoal(cwd))?.runActive).toBe(false);
		expect((await loadGoal(cwd))?.lastError).toBe("steering delivery failed");
	});
});

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "t-886-goal-regression-"));
	directories.push(directory);
	return directory;
}

function createRuntime(): GoalRuntime {
	return {
		resolve: null,
		stopRequested: false,
		pendingMarker: null,
		cancelledMarkers: new Set(),
	};
}

function createCommandContext(
	cwd: string,
	overrides: Partial<
		Pick<ExtensionCommandContext, "waitForIdle" | "newSession">
	> = {},
): ExtensionCommandContext {
	return {
		cwd,
		ui: {
			setStatus: () => undefined,
			setWidget: () => undefined,
			notify: () => undefined,
		},
		waitForIdle: async () => undefined,
		sessionManager: { getSessionFile: () => undefined },
		newSession: async () => ({ cancelled: true }),
		sendUserMessage: async () => undefined,
		hasPendingMessages: () => false,
		isIdle: () => true,
		...overrides,
	} as unknown as ExtensionCommandContext;
}

function createCommandApi(
	sendUserMessage: (message: string, options?: unknown) => void,
): {
	readonly commands: Map<
		string,
		{
			readonly handler: (
				args: string,
				ctx: ExtensionCommandContext,
			) => Promise<void>;
		}
	>;
	registerCommand(
		name: string,
		command: {
			readonly handler: (
				args: string,
				ctx: ExtensionCommandContext,
			) => Promise<void>;
		},
	): void;
	registerTool(tool: unknown): void;
	on(eventName: string, handler: unknown): void;
	appendEntry(type: string, data: unknown): void;
	sendMessage(message: unknown, options?: unknown): void;
	sendUserMessage(message: string, options?: unknown): void;
} {
	const api = {
		commands: new Map<
			string,
			{
				readonly handler: (
					args: string,
					ctx: ExtensionCommandContext,
				) => Promise<void>;
			}
		>(),
		registerCommand(
			name: string,
			command: {
				readonly handler: (
					args: string,
					ctx: ExtensionCommandContext,
				) => Promise<void>;
			},
		): void {
			api.commands.set(name, command);
		},
		registerTool: (_tool: unknown): void => undefined,
		on: (_eventName: string, _handler: unknown): void => undefined,
		appendEntry: (_type: string, _data: unknown): void => undefined,
		sendMessage: (_message: unknown, _options?: unknown): void => undefined,
		sendUserMessage,
	};
	return api;
}
