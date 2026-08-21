/**
 * Regression tests for pi-goal plan mode, schema migration, and stop-and-fix gate.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import goalExtension from "../../extensions/pi-goal/index.js";
import {
	createTextGoal,
	generatePlanState,
	loadGoal,
	saveGoal,
	startRun,
	updateGoal,
	type GoalState,
} from "../../extensions/pi-goal/state.js";

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
	sendUserMessage(message: string, options?: unknown): Promise<void>;
	hasPendingMessages(): boolean;
	isIdle(): boolean;
}

interface FakePi {
	readonly commands: Map<string, { handler: (args: string, ctx: FakeCommandContext) => Promise<void> }>;
	readonly tools: unknown[];
	readonly sentMessages: Array<{ message: unknown; options?: unknown }>;
	readonly handlers: Map<string, unknown[]>;
	registerCommand(name: string, command: { handler: (args: string, ctx: FakeCommandContext) => Promise<void> }): void;
	registerTool(tool: unknown): void;
	on(eventName: string, handler: unknown): void;
	sendMessage(message: unknown, options?: unknown): void;
	sendUserMessage(message: string, options?: unknown): void;
}

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "pi-goal-plan-test-"));
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe("pi-goal plan mode and verification gate", () => {
	it("loads legacy v1 goal state with synthesized plan defaults", async () => {
		const legacy = {
			schemaVersion: 1,
			goalId: "legacy-1",
			objective: "legacy goal",
			status: "active",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			runActive: false,
			turnBudget: 5,
			turnsUsed: 2,
		};
		await mkdir(join(tempDir, ".pi/goal"), { recursive: true });
		await writeFile(join(tempDir, ".pi/goal", "goal.json"), JSON.stringify(legacy, null, 2));
		const loaded = await loadGoal(tempDir);
		expect(loaded).toBeDefined();
		expect(loaded?.schemaVersion).toBe(3);
		expect(loaded?.runMode).toBe("manual");
		expect(loaded?.executionState).toBe("idle");
		expect(loaded?.milestoneRevision).toBe(1);
		expect(loaded?.lastProgressAt).toBe(legacy.updatedAt);
		expect(loaded?.planRequired).toBe(false);
		expect(loaded?.planApproved).toBe(false);
		expect(loaded?.currentMilestoneIndex).toBe(0);
		expect(loaded?.milestones).toEqual([]);
		expect(loaded?.lastVerification).toBeUndefined();
	});

	it("durably migrates v2 state and keeps restart correlation stable", async () => {
		const updatedAt = "2026-08-21T00:00:00.000Z";
		const legacy = {
			schemaVersion: 2,
			goalId: "legacy-v2",
			objective: "restart migration",
			status: "active",
			createdAt: updatedAt,
			updatedAt,
			runId: "old-run",
			runActive: true,
			turnBudget: 4,
			turnsUsed: 1,
			lastVerification: { milestoneIndex: 0, command: "npm test", exitCode: 0, outputSummary: "old" },
		};
		await mkdir(join(tempDir, ".pi/goal"), { recursive: true });
		await writeFile(join(tempDir, ".pi/goal", "goal.json"), JSON.stringify(legacy), "utf8");
		const migrated = await loadGoal(tempDir);
		const persisted = JSON.parse(await readFile(join(tempDir, ".pi/goal", "goal.json"), "utf8")) as GoalState;
		expect(migrated?.schemaVersion).toBe(3);
		expect(persisted.schemaVersion).toBe(3);
		expect(persisted.runMode).toBe("manual");
		expect(persisted.lastProgressAt).toBe(updatedAt);
		expect(persisted.milestoneRevision).toBe(1);
		expect(persisted.lastVerification).toBeUndefined();
		expect((await loadGoal(tempDir))?.lastProgressAt).toBe(updatedAt);
	});

	it("legacy goal completes with evidence-only gate", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		const state = startRun(await createTextGoal(tempDir, "legacy complete"), 5);
		await saveGoal(tempDir, state);

		const tool = findTool(pi, "goal_complete");
		const result = await tool.execute("call-1", { evidence: "all green" }, undefined, undefined, ctx);
		expect(result).toBeDefined();
		const persisted = await loadGoal(tempDir);
		expect(persisted?.status).toBe("complete");
		expect(persisted?.completionEvidence).toBe("all green");
	});

	it("/goal plan generates SPEC, PLAN, and STATUS files and pauses", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		const state = await createTextGoal(tempDir, "Plan mode goal\n- Do thing A\n- Do thing B");
		await saveGoal(tempDir, state);

		await runGoalCommand(pi, "plan", ctx);

		const persisted = await loadGoal(tempDir);
		expect(persisted?.status).toBe("planning");
		expect(persisted?.planRequired).toBe(true);
		expect(persisted?.planApproved).toBe(false);
		expect(persisted?.milestones).toHaveLength(2);
		expect(persisted?.currentMilestoneIndex).toBe(0);

		const spec = await readFile(join(tempDir, ".pi/goal", "SPEC.md"), "utf8");
		expect(spec).toContain("Do thing A");
		expect(spec).toContain("Do thing B");

		const plan = await readFile(join(tempDir, ".pi/goal", "PLAN.md"), "utf8");
		expect(plan).toContain("Do thing A");
		expect(plan).toContain("Do thing B");

		const status = await readFile(join(tempDir, ".pi/goal", "STATUS.md"), "utf8");
		expect(status).toContain("Current milestone");
	});

	it("goal_complete hard-blocks when verification is missing", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		const state = generatePlanState(await createTextGoal(tempDir, "verify me"));
		await saveGoal(tempDir, state);

		const tool = findTool(pi, "goal_complete");
		await expect(
			tool.execute("call-1", { evidence: "looks good" }, undefined, undefined, ctx),
		).rejects.toThrow(/no verification/);

		const persisted = await loadGoal(tempDir);
		expect(persisted?.status).not.toBe("complete");
	});

	it("goal_complete hard-blocks when exitCode is non-zero", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		const state = generatePlanState(await createTextGoal(tempDir, "verify me"));
		await saveGoal(tempDir, state);

		const verify = findTool(pi, "goal_verify");
		await verify.execute("call-v", { exitCode: 1, outputSummary: "tests failed" }, undefined, undefined, ctx);

		const complete = findTool(pi, "goal_complete");
		await expect(
			complete.execute("call-c", { evidence: "looks good" }, undefined, undefined, ctx),
		).rejects.toThrow(/verification failed/);

		const persisted = await loadGoal(tempDir);
		expect(persisted?.status).not.toBe("complete");
	});

	it("goal_complete advances milestone after passing verification", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		const state = generatePlanState(await createTextGoal(tempDir, "two-step goal\n- Step one\n- Step two"));
		await saveGoal(tempDir, state);

		const verify = findTool(pi, "goal_verify");
		await verify.execute("call-v", { exitCode: 0, outputSummary: "step one passed" }, undefined, undefined, ctx);

		const complete = findTool(pi, "goal_complete");
		const result = await complete.execute("call-c", { evidence: "step one done" }, undefined, undefined, ctx);
		expect(result).toBeDefined();

		const persisted = await loadGoal(tempDir);
		expect(persisted?.status).toBe("active");
		expect(persisted?.currentMilestoneIndex).toBe(1);
		expect(persisted?.milestones[0]?.status).toBe("done");
		expect(persisted?.milestones[1]?.status).toBe("in_progress");
		expect(persisted?.lastVerification).toBeUndefined();
	});

	it("goal_complete finishes goal when last milestone passes", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		const state = generatePlanState(await createTextGoal(tempDir, "single milestone goal"));
		await saveGoal(tempDir, state);

		const verify = findTool(pi, "goal_verify");
		await verify.execute("call-v", { exitCode: 0, outputSummary: "all passed" }, undefined, undefined, ctx);

		const complete = findTool(pi, "goal_complete");
		const result = await complete.execute("call-c", { evidence: "done" }, undefined, undefined, ctx);
		expect(result).toBeDefined();

		const persisted = await loadGoal(tempDir);
		expect(persisted?.status).toBe("complete");
		expect(persisted?.completionEvidence).toBe("done");
	});

	it("/goal edit invalidates plan and resets milestone index", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		let state = generatePlanState(await createTextGoal(tempDir, "editable goal\n- First"));
		state = startRun(state, 5);
		state = { ...state, planApproved: true, currentMilestoneIndex: 1 } as GoalState;
		await saveGoal(tempDir, state);

		await runGoalCommand(pi, "edit revised objective", ctx);

		const persisted = await loadGoal(tempDir);
		expect(persisted?.objective).toBe("revised objective");
		expect(persisted?.planApproved).toBe(false);
		expect(persisted?.currentMilestoneIndex).toBe(0);
		expect(persisted?.milestones.every((m) => m.status === "pending")).toBe(true);
		expect(persisted?.lastVerification).toBeUndefined();
	});

	it("regenerateDerivedFiles repairs missing markdown on load", async () => {
		const state = generatePlanState(await createTextGoal(tempDir, "recover me\n- Recoverable task"));
		await saveGoal(tempDir, state);
		await rm(join(tempDir, ".pi/goal", "PLAN.md"), { force: true });
		await rm(join(tempDir, ".pi/goal", "STATUS.md"), { force: true });

		const loaded = await loadGoal(tempDir);
		expect(loaded).toBeDefined();
		await expect(readFile(join(tempDir, ".pi/goal", "PLAN.md"), "utf8")).resolves.toContain("Recoverable task");
		await expect(readFile(join(tempDir, ".pi/goal", "STATUS.md"), "utf8")).resolves.toContain("Current milestone");
	});

	it("continuous mode keeps the run active across a verified non-final milestone", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		let state = startRun(generatePlanState(await createTextGoal(tempDir, "continuous\n- one\n- two")), 5, "continuous");
		await saveGoal(tempDir, state);
		const verify = findTool(pi, "goal_verify");
		await verify.execute("call-v", { exitCode: 0, outputSummary: "one passed" }, undefined, undefined, ctx);
		const complete = findTool(pi, "goal_complete");
		await complete.execute("call-c", { evidence: "one is complete" }, undefined, undefined, ctx);
		state = (await loadGoal(tempDir)) as GoalState;
		expect(state.currentMilestoneIndex).toBe(1);
		expect(state.runMode).toBe("continuous");
		expect(state.runActive).toBe(true);
		expect(state.executionState).toBe("in_progress");
	});

	it("manual mode pauses after a verified non-final milestone", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		const state = startRun(generatePlanState(await createTextGoal(tempDir, "manual\n- one\n- two")), 5, "manual");
		await saveGoal(tempDir, state);
		const verify = findTool(pi, "goal_verify");
		await verify.execute("call-v", { exitCode: 0, outputSummary: "one passed" }, undefined, undefined, ctx);
		const complete = findTool(pi, "goal_complete");
		await complete.execute("call-c", { evidence: "one is complete" }, undefined, undefined, ctx);
		expect((await loadGoal(tempDir))?.runActive).toBe(false);
	});

	it("rejects evidence after a milestone revision changes", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		const state = startRun(generatePlanState(await createTextGoal(tempDir, "stale evidence")), 5, "continuous");
		await saveGoal(tempDir, state);
		const verify = findTool(pi, "goal_verify");
		await verify.execute("call-v", { exitCode: 0, outputSummary: "passed" }, undefined, undefined, ctx);
		const current = (await loadGoal(tempDir)) as GoalState;
		const changedRevision = updateGoal(current, { milestoneRevision: (current.milestoneRevision ?? 0) + 1 });
		await saveGoal(tempDir, changedRevision);
		const complete = findTool(pi, "goal_complete");
		await expect(complete.execute("call-c", { evidence: "stale" }, undefined, undefined, ctx)).rejects.toThrow(/stale|no verification/);

		const oldVerification = current.lastVerification;
		const newRun = startRun(changedRevision, 5, "continuous");
		await saveGoal(tempDir, updateGoal(newRun, { lastVerification: oldVerification }));
		await expect(complete.execute("call-c2", { evidence: "old run" }, undefined, undefined, ctx)).rejects.toThrow(/stale/);
	});
});

function createFakePi(): FakePi {
	const commands = new Map<string, { handler: (args: string, ctx: FakeCommandContext) => Promise<void> }>();
	const tools: unknown[] = [];
	const sentMessages: Array<{ message: unknown; options?: unknown }> = [];
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
		hasPendingMessages: () => false,
		isIdle: () => true,
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

function findTool(
	pi: FakePi,
	name: string,
): {
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal: unknown,
		onUpdate: unknown,
		ctx: FakeCommandContext,
	) => Promise<unknown>;
} {
	const tool = pi.tools.find((entry) =>
		typeof entry === "object" && entry !== null && "name" in entry && entry.name === name,
	) as { execute: (...args: unknown[]) => Promise<unknown> } | undefined;
	if (!tool) throw new Error(`Tool ${name} not registered`);
	return tool;
}

async function runGoalCommand(pi: FakePi, args: string, ctx: FakeCommandContext): Promise<void> {
	const command = pi.commands.get("goal");
	if (!command) throw new Error("goal command not registered");
	await command.handler(args, ctx);
}
