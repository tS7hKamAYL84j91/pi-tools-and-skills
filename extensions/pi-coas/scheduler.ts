/**
 * Pi-hosted CoAS schedule runner.
 *
 * Schedule files describe desired state; this module keeps the in-memory timer
 * state aligned while pi is running and injects due schedule prompts as user
 * messages. It never reads or writes user crontab.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { chmod, mkdir } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { PANOPTICON_SPAWN_NAME_ENV } from "../../lib/agent-registry.js";
import { appendLogLine } from "../../lib/file-persistence.js";
import { isoUtc, scheduleLogRoot } from "./store.js";
import { cronExpressionError, cronFieldMatches, listSchedules } from "./schedules.js";
import { currentWorkspaceLabel } from "./workspace-paths.js";
import type { CoasConfig, ScheduleEntry, SchedulerSnapshot } from "./types.js";

const PANOPTICON_SCOPE_ENV = "PI_PANOPTICON_SCOPE";

const TICK_MS = 60_000;

function minuteKey(date: Date): string {
	return date.toISOString().slice(0, 16);
}

export function scheduleMatchesDate(expr: string, date: Date): boolean {
	if (cronExpressionError(expr)) return false;
	const fields = expr.trim().split(/\s+/);
	const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
	const weekday = date.getDay();
	const weekdayMatches = Boolean(
		dayOfWeek &&
		(cronFieldMatches(dayOfWeek, weekday, 0, 7) ||
			(weekday === 0 && cronFieldMatches(dayOfWeek, 7, 0, 7))),
	);
	return Boolean(
		minute && hour && dayOfMonth && month &&
		cronFieldMatches(minute, date.getMinutes(), 0, 59) &&
		cronFieldMatches(hour, date.getHours(), 0, 23) &&
		cronFieldMatches(dayOfMonth, date.getDate(), 1, 31) &&
		cronFieldMatches(month, date.getMonth() + 1, 1, 12) &&
		weekdayMatches
	);
}

export function renderScheduledPrompt(schedule: ScheduleEntry): string {
	return [
		`CoAS scheduled task: ${schedule.taskName} (${schedule.taskId})`,
		`Workspace: ${schedule.workspaceId}`,
		`Room: ${schedule.roomId || "(none)"}`,
		"",
		"Run the following scheduled CoAS prompt. Use CoAS workspace tools when useful, and record durable non-secret outcomes with coas_workspace_update.",
		"",
		schedule.prompt?.trim() ?? "",
	].join("\n");
}

async function appendScheduleLog(config: CoasConfig, taskId: string, message: string): Promise<void> {
	const root = scheduleLogRoot(config);
	await mkdir(root, { recursive: true, mode: 0o700 });
	const path = join(root, `${taskId}.log`);
	await appendLogLine(path, `[${isoUtc()}] ${message}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await chmod(path, 0o600).catch(() => undefined);
}

export class CoasInternalScheduler {
	private config: CoasConfig | undefined;
	private interval: NodeJS.Timeout | undefined;
	private lastRun = new Map<string, string>();
	private activeRuns = new Set<string>();
	private enabledCount = 0;
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
		this.config = undefined;
		this.lastRun.clear();
		this.activeRuns.clear();
		this.enabledCount = 0;
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
			this.lastError = undefined;
		} catch (error) {
			this.enabledCount = 0;
			this.lastError = (error as Error).message;
		}
	}

	get coasHome(): string | undefined {
		return this.config?.coasHome;
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
		};
	}

	async tick(now: Date): Promise<void> {
		if (!this.config) return;
		let schedules: ScheduleEntry[];
		try {
			schedules = (await listSchedules(this.config)).filter((schedule) => schedule.enabled);
		} catch (error) {
			this.enabledCount = 0;
			this.lastError = (error as Error).message;
			return;
		}
		this.enabledCount = schedules.length;
		for (const schedule of schedules) {
			const error = cronExpressionError(schedule.cronExpr);
			if (error) {
				this.lastError = `invalid schedule ${schedule.taskId}: ${error}`;
				continue;
			}
			if (scheduleMatchesDate(schedule.cronExpr, now)) {
				await this.runOncePerMinute(schedule, minuteKey(now));
			}
		}
	}

	private activeIdentity(): { workspaceId: string; agentName: string; scope: "workspace" | "task" | "unknown" } {
		const scopeRaw = process.env[PANOPTICON_SCOPE_ENV];
		const scope: "workspace" | "task" | "unknown" = scopeRaw === "task" ? "task" : scopeRaw === "workspace" ? "workspace" : "unknown";
		return {
			workspaceId: process.env.COAS_WORKSPACE_ID ?? currentWorkspaceLabel(process.cwd()) ?? "",
			agentName: process.env[PANOPTICON_SPAWN_NAME_ENV] ?? this.pi.getSessionName() ?? "",
			scope,
		};
	}

	private shouldDeliver(schedule: ScheduleEntry): { deliver: boolean; reason: string } {
		const identity = this.activeIdentity();

		if (schedule.targetAgent) {
			if (identity.agentName && identity.agentName === schedule.targetAgent) {
				return { deliver: true, reason: `targetAgent match: ${schedule.targetAgent}` };
			}
			return { deliver: false, reason: `targetAgent ${schedule.targetAgent} does not match active agent ${identity.agentName || "(unknown)"}` };
		}

		if (identity.scope === "task") {
			return { deliver: false, reason: "active session is task-scoped" };
		}

		if (identity.workspaceId && identity.workspaceId !== schedule.workspaceId) {
			return { deliver: false, reason: `workspace mismatch: active ${identity.workspaceId} != schedule ${schedule.workspaceId}` };
		}

		return { deliver: true, reason: "workspace/root identity matches" };
	}

	private async runOncePerMinute(schedule: ScheduleEntry, key: string): Promise<void> {
		const runKey = `${schedule.taskId}:${key}`;
		if (this.lastRun.get(schedule.taskId) === key || this.activeRuns.has(runKey)) return;
		this.lastRun.set(schedule.taskId, key);
		this.activeRuns.add(runKey);
		try {
			const { deliver, reason } = this.shouldDeliver(schedule);
			const identity = this.activeIdentity();
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
			try {
				this.pi.sendUserMessage(renderScheduledPrompt(schedule), { deliverAs: "followUp" });
			} catch (error) {
				this.failedCount++;
				this.lastFailedAt = isoUtc();
				this.lastTaskId = schedule.taskId;
				this.lastError = (error as Error).message;
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
