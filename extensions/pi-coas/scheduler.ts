/**
 * Pi-hosted CoAS schedule runner.
 *
 * Schedule files describe desired state; this module keeps the in-memory timer
 * state aligned while pi is running and injects due schedule prompts as user
 * messages. It never reads or writes user crontab.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { hostname } from "node:os";
import { activeIdentity, shouldDeliver } from "./scheduler-delivery.js";
import { appendScheduleLog } from "./scheduler-log.js";
import {
	extractBoundedSummary,
	extractNextAction,
	findFinalAssistantMessage,
	findScheduledRunMarker,
	renderPromptWithMarker,
} from "./scheduler-prompt.js";
import { markActiveRunsInterrupted, recoverInterruptedRuns, writeInterrupted } from "./scheduler-recovery.js";
import { countContinuationReady, readPriorSummary, saveRunState, type ScheduleRunState } from "./scheduler-run-state.js";
import { isoUtc } from "./store.js";
import { cronExpressionError, listSchedules, scheduleRunsPath } from "./schedules.js";
import { minuteKey, newRunId, scheduleMatchesDate } from "./scheduler-util.js";
import type { CoasConfig, ScheduleEntry, SchedulerSnapshot } from "./types.js";

export { renderScheduledPrompt } from "./scheduler-prompt.js";
export { scheduleMatchesDate } from "./scheduler-util.js";

const TICK_MS = 60_000;

interface ActiveScheduledRun {
	readonly taskId: string;
	readonly runId: string;
	readonly startedAt: string;
}

export class CoasInternalScheduler {
	private config: CoasConfig | undefined;
	private interval: NodeJS.Timeout | undefined;
	private lastRun = new Map<string, string>();
	private activeRuns = new Set<string>();
	private activeScheduledRuns = new Map<string, ActiveScheduledRun>();
	private enabledCount = 0;
	private continuationCount = 0;
	private continuationReady = 0;

	get coasHome(): string | undefined {
		return this.config?.coasHome;
	}
	private lastError: string | undefined;
	private startedAt: string | undefined;
	private queuedCount = 0;
	private failedCount = 0;
	private droppedScheduleRuns = 0;
	private lastQueuedAt: string | undefined;
	private lastFailedAt: string | undefined;
	private lastTaskId: string | undefined;

	constructor(private readonly pi: ExtensionAPI) {}

	start(config: CoasConfig): void {
		this.config = config;
		this.startedAt = this.startedAt ?? isoUtc();
		this.recoverInterruptedRuns(config).catch((error: unknown) => {
			this.lastError = (error as Error).message;
		});
		this.reconcile().catch((error: unknown) => {
			this.lastError = (error as Error).message;
		});
		this.interval ??= setInterval(() => {
			this.tick(new Date()).catch((error: unknown) => {
				this.lastError = (error as Error).message;
			});
		}, TICK_MS);
	}

	stop(): void {
		if (this.interval) clearInterval(this.interval);
		this.interval = undefined;
		if (this.config) {
			this.markActiveRunsInterrupted("session_shutdown").catch((error: unknown) => {
				this.lastError = (error as Error).message;
			});
		}
		this.config = undefined;
		this.lastRun.clear();
		this.activeRuns.clear();
		this.activeScheduledRuns.clear();
		this.enabledCount = 0;
		this.continuationCount = 0;
		this.continuationReady = 0;
		this.lastError = undefined;
		this.startedAt = undefined;
		this.queuedCount = 0;
		this.failedCount = 0;
		this.droppedScheduleRuns = 0;
		this.lastQueuedAt = undefined;
		this.lastFailedAt = undefined;
		this.lastTaskId = undefined;
	}

	async reconcile(config = this.config): Promise<void> {
		if (!config) return;
		this.config = config;
		try {
			const schedules = await listSchedules(config);
			this.enabledCount = schedules.filter((schedule) => schedule.enabled).length;
			this.continuationCount = schedules.filter((schedule) => schedule.enabled && schedule.continuation).length;
			this.continuationReady = await countContinuationReady(config, schedules);
			this.lastError = undefined;
		} catch (error) {
			this.enabledCount = 0;
			this.continuationCount = 0;
			this.continuationReady = 0;
			this.lastError = (error as Error).message;
		}
	}

	snapshot(): SchedulerSnapshot {
		return {
			running: Boolean(this.interval && this.config),
			enabledSchedules: this.enabledCount,
			activeRuns: this.activeRuns.size,
			startedAt: this.startedAt,
			lastError: this.lastError,
			queued: this.queuedCount,
			failed: this.failedCount,
			droppedScheduleRuns: this.droppedScheduleRuns,
			lastQueuedAt: this.lastQueuedAt,
			lastFailedAt: this.lastFailedAt,
			lastTaskId: this.lastTaskId,
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
			this.lastError = (error as Error).message;
			return;
		}
		this.enabledCount = schedules.length;
		this.continuationCount = schedules.filter((schedule) => schedule.continuation).length;
		this.continuationReady = await countContinuationReady(this.config, schedules);
		for (const schedule of schedules) {
			const error = cronExpressionError(schedule.cronExpr);
			if (error) {
				this.lastError = `invalid schedule ${schedule.taskId}: ${error}`;
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
		} catch (error) {
			this.lastError = (error as Error).message;
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
			const identity = activeIdentity(this.pi);
			const { deliver, reason } = shouldDeliver(schedule, identity);
			const identityLog = `session=${identity.agentName || "unknown"} workspace=${identity.workspaceId || "unknown"} scope=${identity.scope}`;
			if (!deliver) {
				this.droppedScheduleRuns++;
				this.lastTaskId = schedule.taskId;
				this.lastFailedAt = isoUtc();
				if (this.config) {
					await this.appendScheduleLogBestEffort(schedule.taskId, `DROPPED ${identityLog} reason=${reason}`);
				}
				return;
			}

			const priorSummary = this.config && schedule.continuation
				? await readPriorSummary(this.config, schedule, now)
				: undefined;
			const runId = newRunId();
			const prompt = renderPromptWithMarker(schedule, runId, priorSummary);

			if (schedule.continuation && this.config) {
				const path = scheduleRunsPath(this.config, schedule.taskId);
				const startedAt = isoUtc(now);
				await saveRunState(path, {
					taskId: schedule.taskId,
					runId,
					status: "running",
					startedAt,
					lastUpdatedAt: startedAt,
				});
				this.activeScheduledRuns.set(runId, {
					taskId: schedule.taskId,
					runId,
					startedAt,
				});
			}

			try {
				this.pi.sendUserMessage(prompt, { deliverAs: "followUp" });
			} catch (error) {
				this.failedCount++;
				this.lastFailedAt = isoUtc();
				this.lastTaskId = schedule.taskId;
				this.lastError = (error as Error).message;
				if (schedule.continuation && this.config) {
					const path = scheduleRunsPath(this.config, schedule.taskId);
					const startedAt = isoUtc(now);
					await writeInterrupted(path, {
						taskId: schedule.taskId,
						runId,
						status: "running",
						startedAt,
						lastUpdatedAt: startedAt,
					}, `send_failed: ${(error as Error).message}`);
					this.activeScheduledRuns.delete(runId);
				}
				if (this.config) await this.appendScheduleLogBestEffort(schedule.taskId, `FAILED internal ${(error as Error).message}`);
				return;
			}
			this.queuedCount++;
			this.lastQueuedAt = isoUtc();
			this.lastTaskId = schedule.taskId;
			if (this.config) await this.appendScheduleLogBestEffort(schedule.taskId, `QUEUED ${identityLog} host=${hostname()}`);
		} finally {
			this.activeRuns.delete(runKey);
		}
	}

	private async appendScheduleLogBestEffort(taskId: string, message: string): Promise<void> {
		if (!this.config) return;
		try {
			await appendScheduleLog(this.config, taskId, message);
		} catch (error) {
			this.lastError = (error as Error).message;
		}
	}
}
