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
import { resumeApprovedRunTracked, type ResumeContext } from "./scheduler-resume.js";
import { countAwaitingApprovals } from "./approval-inbox.js";
import { markActiveRunsInterrupted, recoverInterruptedRuns } from "./scheduler-recovery.js";
import { countContinuationReady, saveRunState, type ScheduleRunState } from "./scheduler-run-state.js";
import { runOncePerMinute, type RunOnceMetrics } from "./scheduler-run-once.js";
import { isoUtc } from "./store-paths.js";
import { cronExpressionError, listSchedules } from "./schedules.js";
import { minuteKey, scheduleMatchesDate } from "./scheduler-util.js";
import { SchedulerRunQueue, type RunExecutor } from "./scheduler-run-queue.js";
import { SchedulerWorkTracker } from "./scheduler-work-tracker.js";
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
	private readonly activeScheduledRuns = new Map<string, ActiveScheduledRun>();
	private readonly runQueue = new SchedulerRunQueue();
	private metrics: RunOnceMetrics = {
		droppedScheduleRuns: 0,
		failedCount: 0,
		queuedCount: 0,
	};
	private enabledCount = 0;
	private continuationCount = 0;
	private continuationReady = 0;
	private awaitingApprovalCount = 0;
	private readonly work = new SchedulerWorkTracker();

	get coasHome(): string | undefined {
		return this.config?.coasHome;
	}
	private startedAt: string | undefined;

	constructor(private readonly pi: ExtensionAPI) {}

	async start(config: CoasConfig): Promise<void> {
		if (!this.work.start()) return;
		this.config = config;
		this.startedAt = this.startedAt ?? isoUtc();
		this.work.track(this.recoverInterruptedRuns(config)).catch((error: unknown) => {
			this.metrics.lastError = (error as Error).message;
		});
		try {
			await this.reconcile(config);
		} catch (error) {
			this.metrics.lastError = (error as Error).message;
		}
		try {
			await this.work.track(this.catchup(new Date()));
		} catch (error) {
			this.metrics.lastError = (error as Error).message;
		}
		this.interval ??= setInterval(() => {
			this.tick(new Date()).catch((error: unknown) => {
				this.metrics.lastError = (error as Error).message;
			});
		}, TICK_MS);
	}

	stop(): Promise<void> {
		if (this.interval) clearInterval(this.interval);
		this.interval = undefined;
		return this.work.stop(() => this.resetAfterStop());
	}

	reconcile(config = this.config): Promise<void> {
		if (!this.work.accepting || !config) return Promise.resolve();
		this.config = config;
		return this.work.track(this.reconcileTracked(config));
	}

	snapshot(): SchedulerSnapshot {
		return {
			running: Boolean(this.interval && this.config),
			enabledSchedules: this.enabledCount,
			activeRuns: this.runQueue.activeRunsCount,
			spawnedRuns: this.runQueue.spawnedRuns,
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
			awaitingApprovalCount: this.awaitingApprovalCount,
		};
	}

	tick(now: Date): Promise<void> {
		if (!this.work.accepting || !this.config) return Promise.resolve();
		return this.work.track(this.tickTracked(now));
	}

	async flush(): Promise<void> {
		return this.runQueue.flush();
	}

	resumeApprovedRun(config: CoasConfig, requestId: string): Promise<boolean> {
		if (!this.work.accepting) return Promise.resolve(false);
		return this.work.track(resumeApprovedRunTracked(this.resumeContext, config, requestId));
	}

	private get resumeContext(): ResumeContext {
		return {
			pi: this.pi,
			config: this.config,
			workAccepting: () => this.work.accepting,
			metrics: this.metrics,
			activeScheduledRuns: this.activeScheduledRuns,
			decrementAwaitingApproval: () => {
				this.awaitingApprovalCount = Math.max(0, this.awaitingApprovalCount - 1);
			},
		};
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
			await saveRunState(this.config, active.taskId, state);
			await finalizeApproval(this.config, active.approvalRequestId, status);
		} catch (error) {
			this.metrics.lastError = (error as Error).message;
		}
		this.activeScheduledRuns.delete(active.runId);
	}

	private async resetAfterStop(): Promise<void> {
		let interruptionError: unknown;
		if (this.config) {
			try {
				await this.markActiveRunsInterrupted("session_shutdown");
			} catch (error) {
				this.metrics.lastError = (error as Error).message;
				interruptionError = error;
			}
		}
		this.config = undefined;
		this.runQueue.clear();
		this.activeScheduledRuns.clear();
		this.metrics = { droppedScheduleRuns: 0, failedCount: 0, queuedCount: 0 };
		this.resetCounts();
		this.startedAt = undefined;
		if (interruptionError !== undefined) throw interruptionError;
	}

	private async reconcileTracked(config: CoasConfig): Promise<void> {
		try {
			const schedules = await listSchedules(config);
			await this.updateCounts(schedules, config);
			this.metrics.lastError = undefined;
		} catch (error) {
			this.resetCounts();
			this.metrics.lastError = (error as Error).message;
		}
	}

	private async tickTracked(now: Date): Promise<void> {
		if (!this.config) return;
		const schedules = await this.loadEnabledSchedules();
		if (schedules === undefined) return;
		await this.updateCounts(schedules, this.config);
		for (const schedule of schedules) {
			const error = cronExpressionError(schedule.cronExpr);
			if (error) {
				this.metrics.lastError = `invalid schedule ${schedule.taskId}: ${error}`;
				continue;
			}
			if (scheduleMatchesDate(schedule.cronExpr, now)) {
				void this.runQueue.spawn(schedule, minuteKey(now), now, this.runExecutor);
			}
		}
	}

	private async loadEnabledSchedules(): Promise<ScheduleEntry[] | undefined> {
		if (!this.config) return undefined;
		try {
			return (await listSchedules(this.config)).filter((schedule) => schedule.enabled);
		} catch (error) {
			this.resetCounts();
			this.metrics.lastError = (error as Error).message;
			return undefined;
		}
	}

	private async updateCounts(schedules: ScheduleEntry[], config: CoasConfig): Promise<void> {
		this.enabledCount = schedules.length;
		this.continuationCount = schedules.filter((schedule) => schedule.continuation).length;
		this.continuationReady = await countContinuationReady(config, schedules);
		this.awaitingApprovalCount = await countAwaitingApprovals(config);
	}

	private resetCounts(): void {
		this.enabledCount = 0;
		this.continuationCount = 0;
		this.continuationReady = 0;
		this.awaitingApprovalCount = 0;
	}

	private async recoverInterruptedRuns(config: CoasConfig): Promise<void> {
		await recoverInterruptedRuns(config);
	}

	private async markActiveRunsInterrupted(reason: string): Promise<void> {
		if (!this.config) return;
		await markActiveRunsInterrupted(this.config, this.activeScheduledRuns.values(), reason);
		this.activeScheduledRuns.clear();
	}

	private async catchup(now: Date): Promise<void> {
		if (!this.config) return;
		await this.runQueue.catchup(now, () => this.loadEnabledSchedules(), this.runExecutor, cronExpressionError);
	}

	private get runExecutor(): RunExecutor {
		return {
			execute: (schedule, now) => this.runBody(schedule, now),
			track: (work) => this.work.track(work),
		};
	}

	private async runBody(schedule: ScheduleEntry, now: Date): Promise<void> {
		if (!this.config) return;
		try {
			const result = await runOncePerMinute({
				pi: this.pi,
				config: this.config,
				schedule,
				now,
				canDispatch: () => this.work.accepting,
				registerActiveRun: (runId, startedAt, approvalRequestId) => {
					this.activeScheduledRuns.set(runId, { taskId: schedule.taskId, runId, startedAt, approvalRequestId });
				},
			}, this.metrics);
			if (result.approvalRequestId && !result.queued) {
				this.awaitingApprovalCount++;
			}
		} catch (error) {
			this.metrics.failedCount++;
			this.metrics.lastFailedAt = isoUtc();
			this.metrics.lastTaskId = schedule.taskId;
			this.metrics.lastError = (error as Error).message;
		}
	}
}
