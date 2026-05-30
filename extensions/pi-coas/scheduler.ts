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
import { appendLogLine } from "../../lib/file-persistence.js";
import { isoUtc, scheduleLogRoot } from "./store.js";
import { listSchedules } from "./schedules.js";
import type { CoasConfig, ScheduleEntry, SchedulerSnapshot } from "./types.js";

const TICK_MS = 60_000;

interface FieldSpec {
	values?: Set<number>;
	any: boolean;
}

function minuteKey(date: Date): string {
	return date.toISOString().slice(0, 16);
}

function parseField(field: string, min: number, max: number): FieldSpec {
	if (field === "*") return { any: true };
	const values = new Set<number>();
	for (const part of field.split(",")) {
		const [range, stepText] = part.split("/");
		const step = stepText ? Number.parseInt(stepText, 10) : 1;
		if (!range || !Number.isInteger(step) || step < 1) return { any: false };
		const [startText, endText] = range === "*" ? [String(min), String(max)] : range.split("-");
		const start = Number.parseInt(startText ?? "", 10);
		const end = Number.parseInt(endText ?? startText ?? "", 10);
		if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) return { any: false };
		for (let value = start; value <= end; value += step) values.add(value);
	}
	return { any: false, values };
}

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
	const spec = parseField(field, min, max);
	return spec.any || Boolean(spec.values?.has(value));
}

function fieldError(label: string, field: string, min: number, max: number): string | undefined {
	const spec = parseField(field, min, max);
	if (spec.any || spec.values) return undefined;
	return `${label} field is invalid: ${field} (expected ${min}-${max}, *, ranges, lists, or steps)`;
}

function scheduleExpressionError(expr: string): string | undefined {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) return "schedule expression must have exactly five fields";
	const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
	return (
		fieldError("minute", minute ?? "", 0, 59) ??
		fieldError("hour", hour ?? "", 0, 23) ??
		fieldError("day-of-month", dayOfMonth ?? "", 1, 31) ??
		fieldError("month", month ?? "", 1, 12) ??
		fieldError("day-of-week", dayOfWeek ?? "", 0, 7)
	);
}

export function scheduleMatchesDate(expr: string, date: Date): boolean {
	if (scheduleExpressionError(expr)) return false;
	const fields = expr.trim().split(/\s+/);
	const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
	const weekday = date.getDay();
	const weekdayMatches = Boolean(
		dayOfWeek &&
		(fieldMatches(dayOfWeek, weekday, 0, 7) ||
			(weekday === 0 && fieldMatches(dayOfWeek, 7, 0, 7))),
	);
	return Boolean(
		minute && hour && dayOfMonth && month &&
		fieldMatches(minute, date.getMinutes(), 0, 59) &&
		fieldMatches(hour, date.getHours(), 0, 23) &&
		fieldMatches(dayOfMonth, date.getDate(), 1, 31) &&
		fieldMatches(month, date.getMonth() + 1, 1, 12) &&
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

	snapshot(): SchedulerSnapshot {
		return {
			running: Boolean(this.interval && this.config),
			enabledSchedules: this.enabledCount,
			activeRuns: this.activeRuns.size,
			startedAt: this.startedAt,
			lastError: this.lastError,
		};
	}

	async tick(now: Date): Promise<void> {
		if (!this.config) return;
		const schedules = (await listSchedules(this.config)).filter((schedule) => schedule.enabled);
		this.enabledCount = schedules.length;
		for (const schedule of schedules) {
			const error = scheduleExpressionError(schedule.cronExpr);
			if (error) {
				this.lastError = `invalid schedule ${schedule.taskId}: ${error}`;
				continue;
			}
			if (scheduleMatchesDate(schedule.cronExpr, now)) {
				await this.runOncePerMinute(schedule, minuteKey(now));
			}
		}
	}

	private async runOncePerMinute(schedule: ScheduleEntry, key: string): Promise<void> {
		const runKey = `${schedule.taskId}:${key}`;
		if (this.lastRun.get(schedule.taskId) === key || this.activeRuns.has(runKey)) return;
		this.lastRun.set(schedule.taskId, key);
		this.activeRuns.add(runKey);
		try {
			this.pi.sendUserMessage(renderScheduledPrompt(schedule), { deliverAs: "followUp" });
			if (this.config) await appendScheduleLog(this.config, schedule.taskId, `QUEUED internal host=${hostname()}`);
		} catch (error) {
			this.lastError = (error as Error).message;
			if (this.config) await appendScheduleLog(this.config, schedule.taskId, `FAILED internal ${(error as Error).message}`);
		} finally {
			this.activeRuns.delete(runKey);
		}
	}
}
