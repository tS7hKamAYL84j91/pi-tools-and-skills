/** In-memory scheduler run queue: deduplication, active tracking, and slot admission. */

import { minuteKey, scheduleMatchesDate } from "./scheduler-util.js";
import type { ScheduleEntry } from "./types.js";
import type { ScheduleSlotState, SlotClaim } from "./scheduler-slot-state.js";

export interface RunExecutionResult {
	readonly outcome: "sent" | "no-send" | "failed";
	readonly handoff: "not-started" | "started" | "unknown";
}

export interface RunExecutor {
	/** Executes one scheduled run after invoking admission immediately before host work. */
	execute(schedule: ScheduleEntry, now: Date, admit?: () => Promise<boolean>, markApprovalPending?: () => Promise<boolean>, claim?: SlotClaim): Promise<RunExecutionResult | undefined | boolean>;
	/** Tracks a spawned promise so shutdown can drain in-flight work. */
	track(work: Promise<unknown>): void;
}

export class SchedulerRunQueue {
	private lastRun = new Map<string, string>();
	private activeRuns = new Set<string>();
	private pendingRuns: Promise<unknown>[] = [];

	constructor(private readonly slotState?: ScheduleSlotState) {}

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
		if (this.lastRun.get(schedule.taskId) === key || this.activeRuns.has(runKey)) return Promise.resolve();
		const runPromise = this.claimAndExecute(schedule, key, now, runKey, executor);
		executor.track(runPromise);
		this.pendingRuns.push(runPromise);
		return runPromise;
	}

	private async claimAndExecute(schedule: ScheduleEntry, key: string, now: Date, runKey: string, executor: RunExecutor): Promise<void> {
		const claim = this.slotState ? await this.slotState.claim(schedule, key, now) : undefined;
		if (this.slotState && !claim) return;
		this.lastRun.set(schedule.taskId, key);
		this.activeRuns.add(runKey);
		const slotState = this.slotState;
		const admitted = async (): Promise<boolean> => claim && slotState ? slotState.admit(claim, new Date()) : true;
		const approvalPending = async (): Promise<boolean> => claim && slotState ? slotState.setApprovalPending(claim, new Date()) : false;
		try {
			const execution = await executor.execute(schedule, now, admitted, approvalPending, claim);
			const result: RunExecutionResult = typeof execution === "object" && execution !== null
				? execution
				: execution === false
					? { outcome: "failed", handoff: "not-started" }
					: { outcome: "sent", handoff: "started" };
			if (claim && slotState) {
				if (result.handoff === "unknown") await slotState.markUncertain(claim, new Date());
				else if (result.handoff === "not-started" && result.outcome === "failed") await slotState.markFailedPreHandoff(claim, new Date());
				else if (result.handoff === "started") {
					await slotState.markHostCalled(claim, new Date());
					await slotState.markHostCallReturned(claim, new Date());
				}
			}
		} catch (error: unknown) {
			if (claim && slotState) await slotState.markUncertain(claim, new Date());
			throw error;
		} finally {
			this.activeRuns.delete(runKey);
		}
	}

	async catchup(now: Date, loadSchedules: () => Promise<ScheduleEntry[] | undefined>, executor: RunExecutor, cronError: (expr: string) => string | undefined): Promise<void> {
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
			if (scheduleMatchesDate(expr, candidate)) return candidate;
		}
		return undefined;
	}

	clear(): void {
		this.lastRun.clear();
		this.activeRuns.clear();
		this.pendingRuns = [];
	}
}
