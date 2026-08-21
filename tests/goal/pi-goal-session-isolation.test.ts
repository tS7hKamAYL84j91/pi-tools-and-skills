/** ADR-051 session-lineage isolation and bounded legacy migration tests. */
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendGoalBinding,
	createGoalSessionScope,
	GOAL_BINDING_CUSTOM_TYPE,
	readGoalBinding,
	type GoalSessionScope,
} from "../../extensions/pi-goal/goal-binding.js";
import { assertGoalId, goalPaths } from "../../extensions/pi-goal/goal-types.js";
import { createTextGoal, loadGoal, saveGoal, clearGoal } from "../../extensions/pi-goal/goal-persist.js";
import { updateGoal } from "../../extensions/pi-goal/goal-plan.js";
import type { GoalState } from "../../extensions/pi-goal/goal-types.js";

interface SessionEntry {
	readonly type: "custom";
	readonly customType: string;
	readonly data: { readonly goalId: string | null };
}

class FakeSessionManager {
	private readonly entries: SessionEntry[] = [];

	getBranch(): readonly SessionEntry[] {
		return this.entries;
	}

	appendCustomEntry(customType: string, data: { readonly goalId: string | null }): void {
		this.entries.push({ type: "custom", customType, data });
	}
}

const tempDirectories: string[] = [];

afterEach(async () => {
	for (const directory of tempDirectories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

function scope(cwd: string, manager: FakeSessionManager): GoalSessionScope {
	return createGoalSessionScope(
		{ cwd, sessionManager: manager },
		(goalId) => manager.appendCustomEntry(GOAL_BINDING_CUSTOM_TYPE, { goalId }),
	);
}

async function newWorkspace(): Promise<string> {
	const cwd = await mkdtemp(join(tmpdir(), "pi-goal-adr051-"));
	tempDirectories.push(cwd);
	return cwd;
}

async function createBoundGoal(cwd: string, manager: FakeSessionManager, text: string): Promise<GoalState> {
	const goalScope = scope(cwd, manager);
	const state = await createTextGoal(cwd, text, goalScope);
	await appendGoalBinding(goalScope, state.goalId);
	await saveGoal(cwd, state, goalScope);
	return state;
}

describe("ADR-051 session-lineage isolation", () => {
	it("isolates state, mutation, and discovery between two sessions sharing a cwd", async () => {
		const cwd = await newWorkspace();
		const first = new FakeSessionManager();
		const second = new FakeSessionManager();
		const firstState = await createBoundGoal(cwd, first, "first goal");
		const secondState = await createBoundGoal(cwd, second, "second goal");

		expect((await loadGoal(cwd, scope(cwd, first)))?.goalId).toBe(firstState.goalId);
		expect((await loadGoal(cwd, scope(cwd, second)))?.goalId).toBe(secondState.goalId);
		await saveGoal(cwd, updateGoal(firstState, { objective: "first changed" }), scope(cwd, first));
		expect((await loadGoal(cwd, scope(cwd, second)))?.objective).toBe("second goal");
		const unbound = new FakeSessionManager();
		expect(await loadGoal(cwd, scope(cwd, unbound))).toBeNull();
	});

	it("clears only the bound instance and records an unbound marker", async () => {
		const cwd = await newWorkspace();
		const first = new FakeSessionManager();
		const second = new FakeSessionManager();
		const firstState = await createBoundGoal(cwd, first, "first goal");
		const secondState = await createBoundGoal(cwd, second, "second goal");

		await clearGoal(cwd, scope(cwd, first));
		expect(readGoalBinding(scope(cwd, first))).toBeNull();
		expect(await loadGoal(cwd, scope(cwd, first))).toBeNull();
		expect((await loadGoal(cwd, scope(cwd, second)))?.goalId).toBe(secondState.goalId);
		await expect(lstat(goalPaths(cwd, firstState.goalId).dir)).rejects.toThrow();
	});

	it("reconstructs a replacement session binding before continuation", async () => {
		const cwd = await newWorkspace();
		const original = new FakeSessionManager();
		const state = await createBoundGoal(cwd, original, "replacement goal");
		const replacement = new FakeSessionManager();
		replacement.appendCustomEntry(GOAL_BINDING_CUSTOM_TYPE, { goalId: state.goalId });

		expect(readGoalBinding(scope(cwd, replacement))).toBe(state.goalId);
		expect((await loadGoal(cwd, scope(cwd, replacement)))?.goalId).toBe(state.goalId);
	});

	it("migrates flat state once, preserves known history, and prevents a concurrent second claim", async () => {
		const cwd = await newWorkspace();
		const legacy = await (async () => {
			const state = await createTextGoal(cwd, "legacy goal");
			await saveGoal(cwd, state);
			await mkdir(join(cwd, ".pi/goal/runs/2026/08/21"), { recursive: true });
			await writeFile(join(cwd, ".pi/goal/runs/2026/08/21/history.jsonl"), "history\n", "utf8");
			return state;
		})();
		const first = new FakeSessionManager();
		const second = new FakeSessionManager();
		const [firstLoaded, secondLoaded] = await Promise.all([
			loadGoal(cwd, scope(cwd, first)),
			loadGoal(cwd, scope(cwd, second)),
		]);
		const claimed = [firstLoaded, secondLoaded].filter((value): value is GoalState => value !== null);
		expect(claimed).toHaveLength(1);
		expect(claimed[0]?.goalId).toBe(legacy.goalId);
		expect(await readFile(join(goalPaths(cwd, legacy.goalId).dir, "runs/2026/08/21/history.jsonl"), "utf8")).toBe("history\n");
		expect((await loadGoal(cwd, scope(cwd, first)))?.goalId ?? (await loadGoal(cwd, scope(cwd, second)))?.goalId).toBe(legacy.goalId);
	});

	it("fails closed for traversal and symlinked instance roots", async () => {
		const cwd = await newWorkspace();
		expect(() => assertGoalId("../escape")).toThrow("Invalid pi-goal id");
		const outside = await mkdtemp(join(tmpdir(), "pi-goal-outside-"));
		tempDirectories.push(outside);
		await mkdir(join(cwd, ".pi/goal"), { recursive: true });
		await symlink(outside, join(cwd, ".pi/goal/instances"));
		const manager = new FakeSessionManager();
		const state: GoalState = {
			schemaVersion: 3,
			goalId: "safe-goal",
			objective: "x",
			status: "active",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			runActive: false,
			turnBudget: 0,
			turnsUsed: 0,
			currentMilestoneIndex: 0,
			milestones: [],
		};
		await appendGoalBinding(scope(cwd, manager), state.goalId);
		await expect(saveGoal(cwd, state, scope(cwd, manager))).rejects.toThrow("symlink");
	});
});
