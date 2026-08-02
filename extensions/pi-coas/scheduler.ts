/**
 * Pi-hosted CoAS schedule runner.
 *
 * Schedule files describe desired state; this module keeps the in-memory timer
 * state aligned while pi is running and injects due schedule prompts as user
 * messages. It never reads or writes user crontab.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	extractBoundedSummary,
	extractNextAction,
	findFinalAssistantMessage,
	findScheduledRunMarker,
} from "./scheduler-prompt.js";
import { finalizeApproval } from "./scheduler-approval.js";
import { markActiveRunsInterrupted, recoverInterruptedRuns } from "./scheduler-recovery.js";
import { countContinuationReady, saveRunState, type ScheduleRunState } from "./scheduler-run-state.js";
import { runOncePerMinute, type RunOnceMetrics } from "./scheduler-run-once.js";
import { isoUtc } from "./store.js";
import { cronExpressionError, listSchedules, scheduleRunsPath } from "./schedules.js";
import { minuteKey, scheduleMatchesDate } from "./scheduler-util.js";
import type { CoasConfig, ScheduleEntry, SchedulerSnapshot } from "./types.js";

export { renderScheduledPrompt } from "./scheduler-prompt.js";
export { scheduleMatchesDate } from "./scheduler-util.js";

const TICK_MS = 60_000;

interface ActiveScheduledRun {
	readonly taskId: string;
	readonly runId: string;
	readonly startedAt: string;
	readonly approvalRequestId?: string;
}

export class CoasInternalScheduler {
	private config: CoasConfig | undefined;
	private interval: NodeJS.Timeout | undefined;
	private lastRun = new Map<string, string>();
	private activeRuns = new Set<string>();
	private activeScheduledRuns = new Map<string, ActiveScheduledRun>();
	private metrics: RunOnceMetrics = {
		droppedScheduleRuns: 0,
		failedCount: 0,
		queuedCount: 0,
	};
	private enabledCount = 0;
	private continuationCount = 0;
	private continuationReady = 0;

	get coasHome(): string | undefined {
		return this.config?.coasHome;
	}
	private startedAt: string | undefined;

	constructor(private readonly pi: ExtensionAPI) {}

	start(config: CoasConfig): void {
		this.config = config;
		this.startedAt = this.startedAt ?? isoUtc();
		this.recoverInterruptedRuns(config).catch((error: unknown) => {
			this.metrics.lastError = (error as Error).message;
		});
		this.reconcile().catch((error: unknown) => {
			this.metrics.lastError = (error as Error).message;
		});
		this.interval ??= setInterval(() => {
			this.tick(new Date()).catch((error: unknown) => {
				this.metrics.lastError = (error as Error).message;
			});
		}, TICK_MS);
	}

	stop(): void {
		if (this.interval) clearInterval(this.interval);
		this.interval = undefined;
		if (this.config) {
			this.markActiveRunsInterrupted("session_shutdown").catch((error: unknown) => {
				this.metrics.lastError = (error as Error).message;
			});
		}
		this.config = undefined;
		this.lastRun.clear();
		this.activeRuns.clear();
		this.activeScheduledRuns.clear();
		this.metrics = { droppedScheduleRuns: 0, failedCount: 0, queuedCount: 0 };
		this.enabledCount = 0;
		this.continuationCount = 0;
		this.continuationReady = 0;
		this.startedAt = undefined;
	}

	async reconcile(config = this.config): Promise<void> {
		if (!config) return;
		this.config = config;
		try {
			const schedules = await listSchedules(config);
			this.enabledCount = schedules.filter((schedule) => schedule.enabled).length;
			this.continuationCount = schedules.filter((schedule) => schedule.enabled && schedule.continuation).length;
			this.continuationReady = await countContinuationReady(config, schedules);
			this.metrics.lastError = undefined;
		} catch (error) {
			this.enabledCount = 0;
			this.continuationCount = 0;
			this.continuationReady = 0;
			this.metrics.lastError = (error as Error).message;
		}
	}

	snapshot(): SchedulerSnapshot {
		return {
			running: Boolean(this.interval && this.config),
			enabledSchedules: this.enabledCount,
			activeRuns: this.activeRuns.size,
			startedAt: this.startedAt,
			lastError: this.metrics.lastError,
			queued: this.metrics.queuedCount,
			failed: this.metrics.failedCount,
			droppedScheduleRuns: this.metrics.droppedScheduleRuns,
			lastQueuedAt: this.metrics.lastQueuedAt,
			lastFailedAt: this.metrics.lastFailedAt,
			lastTaskId: this.metrics.lastTaskId,
			continuationSchedules: this.continuationCount,
			continuationReady: this.continuationReady,
		};
	}

	async tick(now: Date): Promise<void> {
		if (!this.config) return;
		let schedules: ScheduleEntry[];
		try {
			schedules = (await listSchedules(this.config)).filter((schedule) => schedule.enabled);
		} catch (error) {
			this.enabledCount = 0;
			this.continuationCount = 0;
			this.continuationReady = 0;
			this.metrics.lastError = (error as Error).message;
			return;
		}
		this.enabledCount = schedules.length;
		this.continuationCount = schedules.filter((schedule) => schedule.continuation).length;
		this.continuationReady = await countContinuationReady(this.config, schedules);
		for (const schedule of schedules) {
			const error = cronExpressionError(schedule.cronExpr);
			if (error) {
				this.metrics.lastError = `invalid schedule ${schedule.taskId}: ${error}`;
				continue;
			}
			if (scheduleMatchesDate(schedule.cronExpr, now)) {
				await this.runOncePerMinute(schedule, minuteKey(now), now);
			}
		}
	}

	async handleAgentEnd(messages: readonly unknown[]): Promise<void> {
		if (this.activeScheduledRuns.size === 0 || !this.config) return;
		const marker = findScheduledRunMarker(messages);
		if (!marker) return;
		const active = this.activeScheduledRuns.get(marker.runId);
		if (!active || active.taskId !== marker.taskId) return;

		const finalAssistant = findFinalAssistantMessage(messages);
		const status: ScheduleRunState["status"] =
			finalAssistant && (finalAssistant.stopReason === "aborted" || finalAssistant.stopReason === "error")
				? "interrupted"
				: "complete";
		const summary = status === "complete"
			? extractBoundedSummary(messages)
			: `Run interrupted: ${finalAssistant?.errorMessage ?? "unknown reason"}`;
		const nextAction = status === "complete" ? extractNextAction(messages) : undefined;
		const path = scheduleRunsPath(this.config, active.taskId);
		const now = isoUtc();
		const state: ScheduleRunState = {
			taskId: active.taskId,
			runId: active.runId,
			status,
			startedAt: active.startedAt,
			completedAt: now,
			summary,
			nextAction,
			lastUpdatedAt: now,
		};
		try {
			await saveRunState(path, state);
			await finalizeApproval(this.config, active.approvalRequestId, status);
		} catch (error) {
			this.metrics.lastError = (error as Error).message;
		}
		this.activeScheduledRuns.delete(active.runId);
	}

	private async recoverInterruptedRuns(config: CoasConfig): Promise<void> {
		await recoverInterruptedRuns(config);
	}

	private async markActiveRunsInterrupted(reason: string): Promise<void> {
		if (!this.config) return;
		await markActiveRunsInterrupted(this.config, this.activeScheduledRuns.values(), reason);
		this.activeScheduledRuns.clear();
	}

	private async runOncePerMinute(schedule: ScheduleEntry, key: string, now: Date): Promise<void> {
		const runKey = `${schedule.taskId}:${key}`;
		if (this.lastRun.get(schedule.taskId) === key || this.activeRuns.has(runKey)) return;
		this.lastRun.set(schedule.taskId, key);
		this.activeRuns.add(runKey);
		try {
			if (!this.config) return;
			const result = await runOncePerMinute({
				pi: this.pi,
				config: this.config,
				schedule,
				key,
				now,
				registerActiveRun: (runId, startedAt, approvalRequestId) => {
					this.activeScheduledRuns.set(runId, { taskId: schedule.taskId, runId, startedAt, approvalRequestId });
				},
			}, this.metrics);
			if (result.queued && result.runId && (schedule.continuation || result.approvalRequestId)) {
				// already registered by runOncePerMinute on success
			}
		} finally {
			this.activeRuns.delete(runKey);
		}
	}
}
