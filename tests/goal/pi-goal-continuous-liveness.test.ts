import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createTextGoal,
	startRun,
	updateGoal,
} from "../../extensions/pi-goal/state.js";
import { loadGoal } from "../../extensions/pi-goal/goal-persist.js";
import { claimGoal } from "../../extensions/pi-goal/goal-ownership.js";
import {
	readGoalWatchdogConfig,
	startGoalWatchdog,
} from "../../extensions/pi-goal/goal-watchdog.js";

import { writeGoalFixture as saveGoal } from "../fixtures/goal-state.js";

const directories: string[] = [];

afterEach(async () => {
	vi.useRealTimers();
	for (const directory of directories.splice(0))
		await rm(directory, { recursive: true, force: true });
});

describe("pi-goal continuous liveness recovery", () => {
	it("warns once, does not nudge an active turn, then nudges one idle turn", async () => {
		vi.useFakeTimers();
		const cwd = await mkdtemp(join(tmpdir(), "goal-watchdog-"));
		directories.push(cwd);
		const started = startRun(
			await createTextGoal(cwd, "watch me"),
			4,
			"continuous",
		);
		await saveGoal(
			cwd,
			updateGoal(started, { lastProgressAt: new Date(0).toISOString() }),
		);
		await claimGoal(cwd, undefined, "watchdog-owner");
		const persistedBeforeWatchdog = await loadGoal(cwd);
		expect(persistedBeforeWatchdog?.livenessWarningIssued).toBe(false);
		expect(persistedBeforeWatchdog?.lastProgressAt).toBe(
			new Date(0).toISOString(),
		);
		let active = true;
		let warnings = 0;
		let nudges = 0;
		const scheduled: Array<() => void> = [];
		const stop = startGoalWatchdog(
			{
				cwd,
				now: () => 2_000,
				schedule: (callback) => {
					scheduled.push(callback);
					return {};
				},
				cancel: () => undefined,
				getOwner: () => ({ token: "watchdog-owner", generation: 1 }),
				isTurnActive: () => active,
				hasQueuedContinuation: () => false,
				notify: (_message, level) => {
					if (level === "warning") warnings += 1;
				},
				sendNudge: () => {
					nudges += 1;
				},
			},
			{ softTimeoutMs: 1_000, hardTimeoutMs: 5_000 },
		);

		scheduled.shift()?.();
		await vi.waitFor(() => expect(warnings).toBe(1));
		expect(nudges).toBe(0);
		active = false;
		scheduled.shift()?.();
		await vi.waitFor(() => expect(nudges).toBe(1));
		stop();
	});

	it("does not nudge while an in-process continuation is queued", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "goal-watchdog-queued-"));
		directories.push(cwd);
		const started = startRun(
			await createTextGoal(cwd, "queued"),
			2,
			"continuous",
		);
		await saveGoal(
			cwd,
			updateGoal(started, { lastProgressAt: new Date(0).toISOString() }),
		);
		await claimGoal(cwd, undefined, "watchdog-owner");
		const scheduled: Array<() => void> = [];
		let nudges = 0;
		const stop = startGoalWatchdog(
			{
				cwd,
				now: () => 2_000,
				schedule: (callback) => {
					scheduled.push(callback);
					return {};
				},
				cancel: () => undefined,
				isTurnActive: () => false,
				getOwner: () => ({ token: "watchdog-owner", generation: 1 }),
				hasQueuedContinuation: () => true,
				notify: () => undefined,
				sendNudge: () => {
					nudges += 1;
				},
			},
			{ softTimeoutMs: 1_000, hardTimeoutMs: 5_000 },
		);
		scheduled.shift()?.();
		await vi.waitFor(async () =>
			expect((await loadGoal(cwd))?.livenessWarningIssued).toBe(true),
		);
		expect(nudges).toBe(0);
		stop();
		scheduled.shift()?.();
		expect(nudges).toBe(0);
	});

	it("caps operator liveness thresholds", () => {
		expect(
			readGoalWatchdogConfig({
				PI_GOAL_LIVENESS_SOFT_MS: "1",
				PI_GOAL_LIVENESS_HARD_MS: "999999999999",
			}),
		).toEqual({
			softTimeoutMs: 1_000,
			hardTimeoutMs: 86_400_000,
		});
	});

	it("pauses at the hard threshold and clears its timer", async () => {
		vi.useFakeTimers();
		const cwd = await mkdtemp(join(tmpdir(), "goal-watchdog-hard-"));
		directories.push(cwd);
		const started = startRun(
			await createTextGoal(cwd, "hard stop"),
			2,
			"continuous",
		);
		await saveGoal(
			cwd,
			updateGoal(started, { lastProgressAt: new Date(0).toISOString() }),
		);
		await claimGoal(cwd, undefined, "watchdog-owner");
		expect((await loadGoal(cwd))?.lastProgressAt).toBe(
			new Date(0).toISOString(),
		);
		let errors = 0;
		const scheduled: Array<() => void> = [];
		const stop = startGoalWatchdog(
			{
				cwd,
				now: () => 2_000,
				schedule: (callback) => {
					scheduled.push(callback);
					return {};
				},
				cancel: () => undefined,
				isTurnActive: () => false,
				hasQueuedContinuation: () => false,
				notify: (_message, level) => {
					if (level === "error") errors += 1;
				},
				getOwner: () => ({ token: "watchdog-owner", generation: 1 }),
				sendNudge: () => undefined,
			},
			{ softTimeoutMs: 1_000, hardTimeoutMs: 2_000 },
		);
		scheduled.shift()?.();
		await vi.waitFor(async () =>
			expect((await loadGoal(cwd))?.runActive).toBe(false),
		);
		const state = await loadGoal(cwd);
		expect(state?.runActive).toBe(false);
		expect(state?.executionState).toBe("failed");
		expect(errors).toBe(1);
		stop();
		expect(scheduled).toHaveLength(1);
	});
});
