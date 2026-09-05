/** Regression tests for legacy plan migration and direct goal completion. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import goalExtension from "../../extensions/pi-goal/index.js";
import { generatePlanState, removePlan } from "../../extensions/pi-goal/goal-plan.js";
import { createTextGoal, loadGoal } from "../../extensions/pi-goal/state.js";
import type { GoalState } from "../../extensions/pi-goal/goal-types.js";
import { writeGoalFixture as saveGoal } from "../fixtures/goal-state.js";

interface FakeUi {
	readonly notifications: Array<{ message: string; level: string }>;
	setStatus(key: string, value: string | undefined): void;
	setWidget(key: string, value: string[] | undefined): void;
	notify(message: string, level: string): void;
}

interface FakeCommandContext {
	readonly cwd: string;
	readonly ui: FakeUi;
	readonly sessionManager: { getSessionFile(): string | undefined };
	waitForIdle(): Promise<void>;
	newSession(): Promise<{ cancelled: boolean }>;
	sendUserMessage(message: string, options?: unknown): Promise<void>;
	hasPendingMessages(): boolean;
	isIdle(): boolean;
}

interface FakePi {
	readonly commands: Map<string, { handler: (args: string, ctx: FakeCommandContext) => Promise<void> }>;
	readonly tools: unknown[];
	readonly sentMessages: Array<{ message: unknown; options?: unknown }>;
	registerCommand(name: string, command: { handler: (args: string, ctx: FakeCommandContext) => Promise<void> }): void;
	registerTool(tool: unknown): void;
	on(eventName: string, handler: unknown): void;
	sendMessage(message: unknown, options?: unknown): void;
	sendUserMessage(message: string, options?: unknown): void;
}

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "pi-goal-direct-test-"));
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe("pi-goal direct execution migration", () => {
	it("loads legacy v1 goal state with plan gates disabled", async () => {
		const updatedAt = new Date().toISOString();
		const legacy = {
			schemaVersion: 1,
			goalId: "legacy-1",
			objective: "legacy goal",
			status: "active",
			createdAt: updatedAt,
			updatedAt,
			runActive: false,
			turnBudget: 5,
			turnsUsed: 2,
		};
		await mkdir(join(tempDir, ".pi/goal"), { recursive: true });
		await writeFile(join(tempDir, ".pi/goal", "goal.json"), JSON.stringify(legacy));
		const loaded = await loadGoal(tempDir);
		expect(loaded).toMatchObject({
			schemaVersion: 3,
			planRequired: false,
			planApproved: false,
			milestones: [],
		});
	});

	it("reads v2 state without rewriting authority", async () => {
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
		};
		await mkdir(join(tempDir, ".pi/goal"), { recursive: true });
		await writeFile(join(tempDir, ".pi/goal", "goal.json"), JSON.stringify(legacy));
		const migrated = await loadGoal(tempDir);
		const persisted = JSON.parse(await readFile(join(tempDir, ".pi/goal", "goal.json"), "utf8")) as GoalState;
		expect(migrated?.schemaVersion).toBe(3);
		expect(persisted.schemaVersion).toBe(2);
	});

	it("keeps /goal plan and /goal approve as harmless compatibility no-ops", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		await saveGoal(tempDir, await createTextGoal(tempDir, "execute directly"));

		await runGoalCommand(pi, "plan", ctx);
		await runGoalCommand(pi, "approve", ctx);

		const persisted = await loadGoal(tempDir);
		expect(persisted).toMatchObject({ planRequired: false, planApproved: false, milestones: [] });
		expect(ctx.ui.notifications.map((entry) => entry.message).join(" ")).toContain("execute directly");
	});

	it("removes a legacy plan without requiring approval or verification", async () => {
		const planned = generatePlanState(await createTextGoal(tempDir, "old planned goal\n- old milestone"));
		const direct = removePlan(planned);
		expect(direct).toMatchObject({
			status: "active",
			planRequired: false,
			planApproved: false,
			currentMilestoneIndex: 0,
			milestones: [],
			lastVerification: undefined,
		});
	});

	it("goal_complete accepts concrete evidence directly and clears legacy plan state", async () => {
		const pi = createFakePi();
		goalExtension(pi as unknown as ExtensionAPI);
		const ctx = createFakeContext(tempDir);
		await saveGoal(tempDir, generatePlanState(await createTextGoal(tempDir, "complete directly")));

		const complete = findTool(pi, "goal_complete");
		await complete.execute("call-c", { evidence: "tests pass" }, undefined, undefined, ctx);

		expect(await loadGoal(tempDir)).toMatchObject({
			status: "complete",
			runActive: false,
			completionEvidence: "tests pass",
			planRequired: false,
			milestones: [],
		});
	});

	it("regenerates missing derived files", async () => {
		await saveGoal(tempDir, await createTextGoal(tempDir, "recover me"));
		await rm(join(tempDir, ".pi/goal", "STATUS.md"), { force: true });
		expect(await loadGoal(tempDir)).toBeDefined();
		await expect(readFile(join(tempDir, ".pi/goal", "STATUS.md"), "utf8")).resolves.toContain("Turns used");
	});
});

function createFakePi(): FakePi {
	const commands = new Map<string, { handler: (args: string, ctx: FakeCommandContext) => Promise<void> }>();
	const tools: unknown[] = [];
	const sentMessages: Array<{ message: unknown; options?: unknown }> = [];
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
	const notifications: Array<{ message: string; level: string }> = [];
	return {
		cwd,
		ui: {
			notifications,
			setStatus() {},
			setWidget() {},
			notify(message, level) {
				notifications.push({ message, level });
			},
		},
		sessionManager: { getSessionFile: () => undefined },
		async waitForIdle() {},
		async newSession() {
			return { cancelled: true };
		},
		async sendUserMessage() {},
		hasPendingMessages: () => false,
		isIdle: () => true,
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
