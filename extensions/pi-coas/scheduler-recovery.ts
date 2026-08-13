/** Recovery helpers for continuation schedules across session restarts and shutdowns. */

import { listSchedules } from "./schedules.js";
import { loadRunState, saveRunState, type ScheduleRunState } from "./scheduler-run-state.js";
import { isoUtc } from "./store-paths.js";
import type { CoasConfig } from "./types.js";

export async function recoverInterruptedRuns(config: CoasConfig): Promise<void> {
	for (const schedule of await listSchedules(config)) {
		if (!schedule.continuation) continue;
		const state = await loadRunState(config, schedule.taskId);
		if (state?.status === "running") await writeInterrupted(config, schedule.taskId, state, "session_restart");
	}
}

export async function markActiveRunsInterrupted(
	config: CoasConfig,
	activeRuns: Iterable<{ readonly taskId: string; readonly runId: string }>,
	reason: string,
): Promise<void> {
	for (const active of activeRuns) {
		const state = await loadRunState(config, active.taskId);
		if (state?.status === "running" && state.runId === active.runId) {
			await writeInterrupted(config, active.taskId, state, reason);
		}
	}
}

async function writeInterrupted(
	config: CoasConfig,
	taskId: string,
	state: ScheduleRunState,
	reason: string,
): Promise<void> {
	await saveRunState(config, taskId, {
		...state,
		status: "interrupted",
		completedAt: isoUtc(),
		summary: `Run interrupted: ${reason}`,
		nextAction: undefined,
		lastUpdatedAt: isoUtc(),
	});
}
