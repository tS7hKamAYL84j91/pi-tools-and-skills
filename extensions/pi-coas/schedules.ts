/**
 * TypeScript CoAS schedule registry.
 *
 * This manages schedule metadata. Runtime execution is owned by the pi-hosted
 * internal scheduler while a pi session is alive.
 */

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import { appendLogLine } from "../../lib/file-persistence.js";
import {
	assertInside,
	assertSafeId,
	ensureRuntimeDirs,
	formatEnv,
	isoUtc,
	lockRoot,
	parseEnv,
	readOptionalFile,
	removePrivateFiles,
	scheduleLogRoot,
	scheduleRoot,
	slugify,
	workspaceIdFromRoom,
	writePrivateFileAtomic,
} from "./store.js";
import type { CoasConfig, CommandResult, ScheduleAddInput, ScheduleEntry } from "./types.js";

function scheduleEnvPath(config: CoasConfig, taskId: string): string {
	assertSafeId("task id", taskId);
	return join(scheduleRoot(config), `${taskId}.env`);
}

function schedulePromptPath(config: CoasConfig, taskId: string): string {
	assertSafeId("task id", taskId);
	return join(scheduleRoot(config), `${taskId}.prompt`);
}

function scheduleLogPath(config: CoasConfig, taskId: string): string {
	assertSafeId("task id", taskId);
	return join(scheduleLogRoot(config), `${taskId}.log`);
}

function scheduleRunsRoot(config: CoasConfig): string {
	return join(config.coasHome, "schedule-runs");
}

export function scheduleRunsPath(config: CoasConfig, taskId: string): string {
	assertSafeId("task id", taskId);
	return join(scheduleRunsRoot(config), `${taskId}.json`);
}

interface FieldSpec {
	values?: Set<number>;
	any: boolean;
}

function parseCronField(field: string, min: number, max: number): FieldSpec {
	if (field === "*") return { any: true };
	const values = new Set<number>();
	for (const part of field.split(",")) {
		const [range, stepText, extraStep] = part.split("/");
		const step = stepText ? Number.parseInt(stepText, 10) : 1;
		if (!range || extraStep != null || !Number.isInteger(step) || step < 1) return { any: false };
		const rangeParts = range === "*" ? [String(min), String(max)] : range.split("-");
		if (rangeParts.length > 2) return { any: false };
		const [startText, endText] = rangeParts;
		const start = Number.parseInt(startText ?? "", 10);
		const end = Number.parseInt(endText ?? startText ?? "", 10);
		if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) return { any: false };
		for (let value = start; value <= end; value += step) values.add(value);
	}
	return { any: false, values };
}

function cronFieldError(label: string, field: string, min: number, max: number): string | undefined {
	const spec = parseCronField(field, min, max);
	if (spec.any || spec.values) return undefined;
	return `${label} field is invalid: ${field} (expected ${min}-${max}, *, ranges, lists, or steps)`;
}

export function cronExpressionError(expr: string): string | undefined {
	if (/\r|\n/.test(expr)) return "Cron expression must have exactly five fields";
	const fields = expr.trim().split(" ");
	if (fields.length !== 5 || fields.some((field) => field.length === 0)) {
		return "Cron expression must have exactly five fields";
	}
	const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
	return (
		cronFieldError("minute", minute ?? "", 0, 59) ??
		cronFieldError("hour", hour ?? "", 0, 23) ??
		cronFieldError("day-of-month", dayOfMonth ?? "", 1, 31) ??
		cronFieldError("month", month ?? "", 1, 12) ??
		cronFieldError("day-of-week", dayOfWeek ?? "", 0, 7)
	);
}

export function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
	const spec = parseCronField(field, min, max);
	return spec.any || Boolean(spec.values?.has(value));
}

export function validateCronExpr(expr: string): void {
	const error = cronExpressionError(expr);
	if (error) throw new Error(error);
}

async function parseSchedule(config: CoasConfig, envPath: string): Promise<ScheduleEntry> {
	const values = parseEnv(await readFile(envPath, "utf8"));
	const taskId = values.TASK_ID ?? basename(envPath, ".env");
	assertSafeId("task id", taskId);
	const cronExpr = values.CRON_EXPR ?? "";
	try {
		validateCronExpr(cronExpr);
	} catch (error) {
		throw new Error(`schedule ${taskId} (${basename(envPath)}): ${(error as Error).message}`);
	}
	const promptFile = values.PROMPT_FILE ?? schedulePromptPath(config, taskId);
	assertInside(scheduleRoot(config), promptFile);
	const workspaceId = values.WORKSPACE_ID ?? workspaceIdFromRoom(values.ROOM_ID ?? values.ROOM_REF ?? "default");
	assertSafeId("workspace id", workspaceId);
	return {
		taskId,
		taskName: values.TASK_NAME ?? taskId,
		roomId: values.ROOM_ID ?? values.ROOM_REF ?? "",
		workspaceId,
		cronExpr,
		enabled: (values.ENABLED ?? "1") === "1",
		promptFile,
		createdAt: values.CREATED_AT,
		updatedAt: values.UPDATED_AT,
		prompt: await readOptionalFile(promptFile),
		targetAgent: values.TARGET_AGENT,
		continuation: (values.CONTINUATION ?? "0") === "1",
	};
}

export async function listSchedules(config: CoasConfig): Promise<ScheduleEntry[]> {
	const root = scheduleRoot(config);
	if (!existsSync(root)) return [];
	const entries = await readdir(root, { withFileTypes: true });
	const schedules: ScheduleEntry[] = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".env")) continue;
		schedules.push(await parseSchedule(config, join(root, entry.name)));
	}
	return schedules.sort((a, b) => a.taskId.localeCompare(b.taskId));
}

export function formatScheduleList(schedules: ScheduleEntry[]): string {
	const header = `${"TASK".padEnd(24)} ${"ENABLED".padEnd(7)} ${"CRON".padEnd(15)} ${"WORKSPACE".padEnd(18)} ${"TARGET".padEnd(16)} NAME`;
	const rows = schedules.map((schedule) => [
		schedule.taskId.padEnd(24),
		(schedule.enabled ? "1" : "0").padEnd(7),
		schedule.cronExpr.padEnd(15),
		schedule.workspaceId.padEnd(18),
		(schedule.targetAgent ?? "").padEnd(16),
		schedule.taskName,
	].join(" "));
	return [header, ...rows].join("\n");
}

export async function addSchedule(config: CoasConfig, input: ScheduleAddInput): Promise<ScheduleEntry> {
	if (!input.room || !input.name || !input.cron || !input.prompt) {
		throw new Error("Schedule add requires room, name, cron, and prompt");
	}
	validateCronExpr(input.cron);
	const taskId = slugify(input.name, "task");
	assertSafeId("task id", taskId);
	const workspaceId = input.workspace ? slugify(input.workspace) : workspaceIdFromRoom(input.room);
	assertSafeId("workspace id", workspaceId);
	await ensureRuntimeDirs(config);
	const envPath = scheduleEnvPath(config, taskId);
	const promptPath = schedulePromptPath(config, taskId);
	if (existsSync(envPath) || existsSync(promptPath)) {
		throw new Error(`Schedule already exists: ${taskId}`);
	}
	const now = isoUtc();
	await withFileMutationQueue(envPath, async () => {
		try {
			await writePrivateFileAtomic(promptPath, `${input.prompt}\n`);
			await writePrivateFileAtomic(envPath, formatEnv({
				TASK_ID: taskId,
				TASK_NAME: input.name,
				ROOM_ID: input.room,
				WORKSPACE_ID: workspaceId,
				CRON_EXPR: input.cron,
				ENABLED: input.disabled ? "0" : "1",
				PROMPT_FILE: promptPath,
				...(input.targetAgent ? { TARGET_AGENT: input.targetAgent } : {}),
				...(input.continuation ? { CONTINUATION: "1" } : {}),
				CREATED_AT: now,
				UPDATED_AT: now,
			}));
		} catch (error) {
			await removePrivateFiles([promptPath]);
			throw error;
		}
	});
	return parseSchedule(config, envPath);
}

export async function removeSchedule(config: CoasConfig, taskId: string): Promise<string> {
	assertSafeId("task id", taskId);
	await removePrivateFiles([
		scheduleEnvPath(config, taskId),
		schedulePromptPath(config, taskId),
		scheduleRunsPath(config, taskId),
	]);
	return `coas-schedule: removed ${taskId}`;
}

async function readSchedule(config: CoasConfig, taskId: string): Promise<ScheduleEntry> {
	const envPath = scheduleEnvPath(config, taskId);
	if (!existsSync(envPath)) throw new Error(`Unknown schedule task: ${taskId}`);
	return parseSchedule(config, envPath);
}

async function logTask(config: CoasConfig, taskId: string, message: string): Promise<void> {
	await mkdir(scheduleLogRoot(config), { recursive: true, mode: 0o700 });
	const path = scheduleLogPath(config, taskId);
	await appendLogLine(path, `[${isoUtc()}] ${message}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await chmod(path, 0o600).catch(() => undefined);
}

export async function runSchedule(config: CoasConfig, taskId: string, dryRun: boolean): Promise<CommandResult> {
	const schedule = await readSchedule(config, taskId);
	const sessionDir = join(config.coasHome, "pi-sessions", "schedules", schedule.taskId);
	const logFile = scheduleLogPath(config, schedule.taskId);
	const lockPath = join(lockRoot(config), `${schedule.workspaceId}.lock`);
	const prompt = schedule.prompt ?? "";
	if (!schedule.enabled) {
		return { code: 0, stdout: "", stderr: `coas-schedule: task disabled: ${schedule.taskId}` };
	}
	if (dryRun) {
		return {
			code: 0,
			stderr: "",
			stdout: [
				`task: ${schedule.taskId}`,
				`workspace: ${schedule.workspaceId}`,
				`session-dir: ${sessionDir}`,
				`lock: ${lockPath}`,
				`log: ${logFile}`,
				"runner: pi-hosted internal scheduler",
				"prompt:",
				...prompt.split("\n").filter((line) => line.length > 0).map((line) => `  ${line}`),
			].join("\n"),
		};
	}
	await ensureRuntimeDirs(config);
	await logTask(config, schedule.taskId, `SKIP execution unsupported host=${hostname()}`);
	return {
		code: 1,
		stdout: "",
		stderr: "coas-schedule: direct execution is disabled; enabled schedules run through the pi-hosted internal scheduler",
	};
}

export async function renderInternalSchedulePlan(config: CoasConfig): Promise<CommandResult> {
	const schedules = (await listSchedules(config)).filter((schedule) => schedule.enabled);
	const body = schedules.length > 0
		? schedules.map((schedule) => `${schedule.cronExpr} ${schedule.taskId} -> pi internal scheduler`).join("\n")
		: "no enabled CoAS schedules";
	return {
		code: 0,
		stderr: "",
		stdout: ["CoAS internal scheduler plan", "============================", body].join("\n"),
	};
}
