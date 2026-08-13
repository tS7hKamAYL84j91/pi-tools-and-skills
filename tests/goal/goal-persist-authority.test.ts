import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface AtomicControl {
	failPath?: string;
	writes: string[];
}

const atomicControl = vi.hoisted((): AtomicControl => ({ writes: [] }));

vi.mock("../../lib/file-persistence.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../lib/file-persistence.js")>();
	return {
		...actual,
		writeFileAtomic: async (...args: Parameters<typeof actual.writeFileAtomic>) => {
			const [path] = args;
			atomicControl.writes.push(path);
			if (path === atomicControl.failPath) {
				throw new Error(`injected atomic write failure: ${path}`);
			}
			await actual.writeFileAtomic(...args);
		},
	};
});

import { loadGoal, saveGoal } from "../../extensions/pi-goal/goal-persist.js";
import {
	renderGoalMarkdown,
	renderPlanMarkdown,
	renderSpecMarkdown,
	renderStatusMarkdown,
} from "../../extensions/pi-goal/goal-render.js";
import { goalPaths, type GoalState } from "../../extensions/pi-goal/goal-types.js";

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "goal-authority-"));
	atomicControl.failPath = undefined;
	atomicControl.writes = [];
});

afterEach(async () => {
	atomicControl.failPath = undefined;
	await rm(tempDir, { recursive: true, force: true });
});

function goal(objective: string): GoalState {
	return {
		schemaVersion: 1,
		goalId: "goal-authority-test",
		objective,
		status: "active",
		createdAt: "2026-08-12T00:00:00.000Z",
		updatedAt: "2026-08-12T00:00:00.000Z",
		runActive: false,
		turnBudget: 0,
		turnsUsed: 0,
		currentMilestoneIndex: 0,
		milestones: [],
	};
}

async function readProjections(cwd: string): Promise<string[]> {
	const paths = goalPaths(cwd);
	return Promise.all([
		readFile(paths.summaryPath, "utf8"),
		readFile(paths.specPath, "utf8"),
		readFile(paths.planPath, "utf8"),
		readFile(paths.statusPath, "utf8"),
	]);
}

function expectedProjections(state: GoalState): string[] {
	return [
		renderGoalMarkdown(state),
		renderSpecMarkdown(state),
		renderPlanMarkdown(state),
		renderStatusMarkdown(state),
	];
}

describe("Goal authority and projection ordering", () => {
	it("does not write new projections when the authority write fails", async () => {
		const oldState = goal("old authority");
		const newState = goal("new projection content");
		await saveGoal(tempDir, oldState);
		const oldProjections = await readProjections(tempDir);
		const paths = goalPaths(tempDir);
		atomicControl.writes = [];
		atomicControl.failPath = paths.statePath;

		await expect(saveGoal(tempDir, newState)).rejects.toThrow("injected atomic write failure");

		const authority = JSON.parse(await readFile(paths.statePath, "utf8")) as GoalState;
		expect(authority.objective).toBe("old authority");
		expect(await readProjections(tempDir)).toEqual(oldProjections);
		expect(atomicControl.writes).toEqual([paths.statePath]);
	});

	it("loads authority first and rewrites every stale existing projection after interruption", async () => {
		const oldState = goal("old authority");
		const newState = goal("new authority");
		await saveGoal(tempDir, oldState);
		const paths = goalPaths(tempDir);
		atomicControl.failPath = paths.specPath;

		await expect(saveGoal(tempDir, newState)).rejects.toThrow("injected atomic write failure");

		const authority = JSON.parse(await readFile(paths.statePath, "utf8")) as GoalState;
		expect(authority.objective).toBe("new authority");
		expect(await readFile(paths.summaryPath, "utf8")).toBe(renderGoalMarkdown(newState));
		expect(await readFile(paths.specPath, "utf8")).toBe(renderSpecMarkdown(oldState));

		atomicControl.failPath = undefined;
		atomicControl.writes = [];
		const loaded = await loadGoal(tempDir);
		expect(loaded?.objective).toBe("new authority");
		if (!loaded) {
			throw new Error("Expected authoritative Goal state to load");
		}

		expect(await readProjections(tempDir)).toEqual(expectedProjections(loaded));
		expect(atomicControl.writes).toEqual([
			paths.summaryPath,
			paths.specPath,
			paths.planPath,
			paths.statusPath,
		]);
	});
});
