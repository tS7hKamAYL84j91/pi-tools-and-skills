/** In-memory scheduler run queue: deduplication, active tracking, and flush. */

import { minuteKey, scheduleMatchesDate } from "./scheduler-util.js";
import type { ScheduleEntry } from "./types.js";

export interface RunExecutor {
	/** Executes one scheduled run. */
	execute(schedule: ScheduleEntry, now: Date): Promise<void>;
	/** Tracks a spawned promise so shutdown can drain in-flight work. */
	track(work: Promise<unknown>): void;
}

export class SchedulerRunQueue {
	private lastRun = new Map<string, string>();
	private activeRuns = new Set<string>();
	private pendingRuns: Promise<unknown>[] = [];

	get activeRunsCount(): number {
		return this.activeRuns.size;
	}

	get spawnedRuns(): number {
		return this.pendingRuns.length;
	}

	async flush(): Promise<void> {
		while (this.pendingRuns.length > 0) {
			const batch = this.pendingRuns.splice(0);
			await Promise.all(batch);
		}
	}

	spawn(schedule: ScheduleEntry, key: string, now: Date, executor: RunExecutor): Promise<void> {
		const runKey = `${schedule.taskId}:${key}`;
		if (this.lastRun.get(schedule.taskId) === key || this.activeRuns.has(runKey)) {
			return Promise.resolve();
		}
		this.lastRun.set(schedule.taskId, key);
		this.activeRuns.add(runKey);
		const runPromise = executor.execute(schedule, now).finally(() => {
			this.activeRuns.delete(runKey);
		});
		executor.track(runPromise);
		this.pendingRuns.push(runPromise);
		return runPromise;
	}

	async catchup(
		now: Date,
		loadSchedules: () => Promise<ScheduleEntry[] | undefined>,
		executor: RunExecutor,
		cronError: (expr: string) => string | undefined,
	): Promise<void> {
		const schedules = await loadSchedules();
		if (schedules === undefined) return;
		const startMs = now.getTime() - 24 * 60 * 60 * 1000;
		for (const schedule of schedules) {
			if (cronError(schedule.cronExpr)) continue;
			const missed = this.findMostRecentMissedMinute(schedule.cronExpr, now, startMs);
			if (!missed) continue;
			void this.spawn(schedule, minuteKey(missed), missed, executor);
		}
	}

	findMostRecentMissedMinute(expr: string, now: Date, startMs: number): Date | undefined {
		const nowKey = minuteKey(now);
		const endMinute = Math.floor(now.getTime() / 60_000) * 60_000;
		for (let t = endMinute; t >= startMs; t -= 60_000) {
			const candidate = new Date(t);
			if (minuteKey(candidate) === nowKey) continue;
			if (scheduleMatchesDate(expr, candidate)) {
				return candidate;
			}
		}
		return undefined;
	}

	clear(): void {
		this.lastRun.clear();
		this.activeRuns.clear();
		this.pendingRuns = [];
	}
}
