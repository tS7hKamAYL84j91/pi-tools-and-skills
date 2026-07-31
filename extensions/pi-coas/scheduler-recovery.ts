/**
 * Recovery helpers for continuation schedules across session restarts and shutdowns.
 */
import { isoUtc } from "./store.js";
import { listSchedules, scheduleRunsPath } from "./schedules.js";
import { loadRunState, saveRunState, type ScheduleRunState } from "./scheduler-run-state.js";
import type { CoasConfig } from "./types.js";

export async function recoverInterruptedRuns(config: CoasConfig): Promise<void> {
	const schedules = await listSchedules(config);
	for (const schedule of schedules) {
		if (!schedule.continuation) continue;
		const path = scheduleRunsPath(config, schedule.taskId);
		const state = await loadRunState(path);
		if (state?.status === "running") {
			await writeInterrupted(path, state, "session_restart");
		}
	}
}

export async function markActiveRunsInterrupted(
	config: CoasConfig,
	activeRuns: Iterable<{ readonly taskId: string; readonly runId: string }>,
	reason: string,
): Promise<void> {
	for (const active of activeRuns) {
		const path = scheduleRunsPath(config, active.taskId);
		const state = await loadRunState(path);
		if (state?.status === "running" && state.runId === active.runId) {
			await writeInterrupted(path, state, reason);
		}
	}
}

export async function writeInterrupted(path: string, state: ScheduleRunState, reason: string): Promise<void> {
	await saveRunState(path, {
		...state,
		status: "interrupted",
		completedAt: isoUtc(),
		summary: `Run interrupted: ${reason}`,
		nextAction: undefined,
		lastUpdatedAt: isoUtc(),
	});
}
