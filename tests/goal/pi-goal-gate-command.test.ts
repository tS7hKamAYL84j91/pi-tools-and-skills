import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGoal, saveGoal } from "../../extensions/pi-goal/goal-persist.js";
import { registerGoalTools } from "../../extensions/pi-goal/goal-tools.js";
import type { GoalState } from "../../extensions/pi-goal/goal-types.js";

const tempDirs: string[] = [];

function makeGoal(): GoalState {
	return {
		schemaVersion: 2,
		goalId: "goal-1",
		objective: "Test autonomous gate",
		status: "active",
		planRequired: false,
		milestones: [],
		currentMilestoneIndex: 0,
		runId: "run-1",
		runActive: false,
		turnBudget: 50,
		turnsUsed: 0,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
}

function mockPi() {
	const tools: Array<{ name: string; execute: (id: string, params: Record<string, unknown>, signal: AbortSignal, _onUpdate: unknown, ctx: { cwd: string }) => Promise<unknown> }> = [];
	return {
		registerTool(def: { name: string; execute: (id: string, params: Record<string, unknown>, signal: AbortSignal, _onUpdate: unknown, ctx: { cwd: string }) => Promise<unknown> }) {
			tools.push(def);
		},
		async callTool(name: string, params: Record<string, unknown>, cwd: string, signal?: AbortSignal) {
			const tool = tools.find((t) => t.name === name);
			if (!tool) throw new Error(`Unknown tool ${name}`);
			return tool.execute("id", params, signal ?? new AbortController().signal, undefined, { cwd });
		},
	};
}

async function makeWorkspace(): Promise<{ cwd: string; goal: GoalState }> {
	const cwd = `${tmpdir()}/pi-goal-gate-${process.pid}-${Date.now()}`;
	mkdirSync(cwd, { recursive: true });
	mkdirSync(join(cwd, ".pi", "goal"), { recursive: true });
	tempDirs.push(cwd);
	const goal = makeGoal();
	await saveGoal(cwd, goal);
	return { cwd, goal };
}

describe("goal_complete gate_command", () => {
	let runtime: ReturnType<typeof mockPi>;
	let refreshCalls: Array<GoalState | null | undefined>;

	beforeEach(() => {
		runtime = mockPi();
		refreshCalls = [];
		registerGoalTools(runtime as never, { resolve: null, stopRequested: false, pendingMarker: null, cancelledMarkers: new Set() }, async (_ctx, state) => {
			refreshCalls.push(state);
		});
	});

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("completes when gate exits 0", async () => {
		const { cwd } = await makeWorkspace();
		const result = await runtime.callTool("goal_complete", {
			evidence: "All checks passed",
			gate_command: "exit 0",
		}, cwd);
		expect(result).toBeDefined();
		const state = await loadGoal(cwd);
		expect(state?.status).toBe("complete");
		expect(state?.completionEvidence).toContain("All checks passed");
	});

	it("blocks completion when gate exits non-zero", async () => {
		const { cwd } = await makeWorkspace();
		await expect(
			runtime.callTool("goal_complete", {
				evidence: "Should not persist",
				gate_command: "echo 'gate failed' >&2; exit 1",
			}, cwd),
		).rejects.toThrow(/gate failed/);
		const state = await loadGoal(cwd);
		expect(state?.status).toBe("active");
		expect(state?.completionEvidence).toBeUndefined();
	});

	it("remains backward-compatible without gate_command", async () => {
		const { cwd } = await makeWorkspace();
		const result = await runtime.callTool("goal_complete", { evidence: "No gate" }, cwd);
		expect(result).toBeDefined();
		const state = await loadGoal(cwd);
		expect(state?.status).toBe("complete");
		expect(state?.completionEvidence).toBe("No gate");
	});
});
