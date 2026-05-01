/**
 * TypeScript CoAS schedule registry.
 *
 * This intentionally manages schedule metadata only. It does not execute stored
 * prompts or arbitrary shell commands; execution requires a future standalone
 * runner with its own security review.
 */

import { existsSync } from "node:fs";
import { appendFile, chmod, mkdir, readdir, readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
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

export function validateCronExpr(expr: string): void {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5 || fields.some((field) => field.length === 0 || /[\n\r]/.test(field))) {
		throw new Error("Cron expression must have exactly five fields");
	}
}

async function parseSchedule(config: CoasConfig, envPath: string): Promise<ScheduleEntry> {
	const values = parseEnv(await readFile(envPath, "utf8"));
	const taskId = values.TASK_ID ?? basename(envPath, ".env");
	assertSafeId("task id", taskId);
	const cronExpr = values.CRON_EXPR ?? "";
	validateCronExpr(cronExpr);
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
	const header = `${"TASK".padEnd(24)} ${"ENABLED".padEnd(7)} ${"CRON".padEnd(15)} ${"WORKSPACE".padEnd(18)} NAME`;
	const rows = schedules.map((schedule) => [
		schedule.taskId.padEnd(24),
		(schedule.enabled ? "1" : "0").padEnd(7),
		schedule.cronExpr.padEnd(15),
		schedule.workspaceId.padEnd(18),
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
	await removePrivateFiles([scheduleEnvPath(config, taskId), schedulePromptPath(config, taskId)]);
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
	await appendFile(path, `[${isoUtc()}] ${message}\n`, { encoding: "utf8", mode: 0o600 });
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
				"command: unsupported in TypeScript extension (dry-run only)",
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
		stderr: "coas-schedule: execution is disabled in the TypeScript extension; use dry-run until a standalone runner is implemented",
	};
}

export async function renderCrontab(config: CoasConfig): Promise<CommandResult> {
	const schedules = (await listSchedules(config)).filter((schedule) => schedule.enabled);
	const body = schedules.length > 0
		? schedules.map((schedule) => `# ${schedule.cronExpr} ${schedule.taskId} (execution disabled: no standalone TypeScript runner)`).join("\n")
		: "# no enabled CoAS schedules";
	return {
		code: 0,
		stderr: "",
		stdout: ["# BEGIN COAS SCHEDULES", body, "# END COAS SCHEDULES"].join("\n"),
	};
}

export function cronDisabled(action: "install-cron" | "uninstall-cron"): CommandResult {
	return {
		code: 1,
		stdout: "",
		stderr: `coas-schedule ${action}: disabled in pi-coas TypeScript runtime until a standalone runner is implemented`,
	};
}
