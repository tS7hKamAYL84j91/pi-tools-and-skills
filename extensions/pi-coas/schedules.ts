/** CoAS schedule registry; runtime execution is owned by the pi-hosted scheduler. */

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import { removeApprovalArtifactsForTask } from "./approval-inbox.js";
import { ConfinedStore, ensureRuntimeDirs } from "./store.js";
import {
	assertInside,
	assertSafeId,
	formatEnv,
	isoUtc,
	lockRoot,
	parseEnv,
	scheduleLogRoot,
	scheduleRoot,
	slugify,
	workspaceIdFromRoom,
} from "./store-paths.js";
import {
	cronExpressionError as evaluateCronExpressionError,
	cronFieldMatches as evaluateCronFieldMatches,
	validateCronExpr as evaluateValidateCronExpr,
} from "./scheduler-evaluation.js";
import type { CoasConfig, CommandResult, ScheduleAddInput, ScheduleEntry } from "./types.js";

/** @public */
export function cronExpressionError(expr: string): string | undefined {
	return evaluateCronExpressionError(expr);
}

/** @public */
export function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
	return evaluateCronFieldMatches(field, value, min, max);
}

/** @public */
export function validateCronExpr(expr: string): void {
	evaluateValidateCronExpr(expr);
}

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

async function parseSchedule(config: CoasConfig, store: ConfinedStore, envPath: string): Promise<ScheduleEntry> {
	const values = parseEnv(await store.readRequiredFile(envPath));
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
		prompt: await store.readOptionalFile(promptFile),
		targetAgent: values.TARGET_AGENT,
		continuation: (values.CONTINUATION ?? "0") === "1",
		approvalRequired: (values.APPROVAL_REQUIRED ?? "0") === "1",
		runBudget: parseOptionalPositiveInt(values.RUN_BUDGET),
		lookback: parseOptionalPositiveInt(values.LOOKBACK),
		modelSnapshot: values.MODEL_SNAPSHOT || undefined,
	};
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed) || parsed <= 0) return undefined;
	return parsed;
}

export async function listSchedules(config: CoasConfig): Promise<ScheduleEntry[]> {
	const homeStore = await ConfinedStore.openCoasHome(config);
	const root = scheduleRoot(config);
	if (!homeStore || !await homeStore.fileExists(root)) return [];
	const store = await ConfinedStore.forScheduleRoot(config);
	const schedules: ScheduleEntry[] = [];
	for (const entry of await store.readDirectory(root)) {
		if (!entry.isFile() || !entry.name.endsWith(".env")) continue;
		schedules.push(await parseSchedule(config, store, join(root, entry.name)));
	}
	return schedules.sort((first, second) => first.taskId.localeCompare(second.taskId));
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
	if (!input.room || !input.name || !input.cron || !input.prompt) throw new Error("Schedule add requires room, name, cron, and prompt");
	validateCronExpr(input.cron);
	const taskId = slugify(input.name, "task");
	assertSafeId("task id", taskId);
	const workspaceId = input.workspace ? slugify(input.workspace) : workspaceIdFromRoom(input.room);
	assertSafeId("workspace id", workspaceId);
	await ensureRuntimeDirs(config);
	const store = await ConfinedStore.forScheduleRoot(config);
	const envPath = scheduleEnvPath(config, taskId);
	const promptPath = schedulePromptPath(config, taskId);
	if (await store.fileExists(envPath) || await store.fileExists(promptPath)) throw new Error(`Schedule already exists: ${taskId}`);
	const now = isoUtc();
	await withFileMutationQueue(envPath, async () => {
		try {
			await store.writePrivateFileAtomic(promptPath, `${input.prompt}\n`);
			await store.writePrivateFileAtomic(envPath, formatEnv({
				TASK_ID: taskId,
				TASK_NAME: input.name,
				ROOM_ID: input.room,
				WORKSPACE_ID: workspaceId,
				CRON_EXPR: input.cron,
				ENABLED: input.disabled ? "0" : "1",
				PROMPT_FILE: promptPath,
				...(input.targetAgent ? { TARGET_AGENT: input.targetAgent } : {}),
				...(input.continuation ? { CONTINUATION: "1" } : {}),
				...(input.approvalRequired ? { APPROVAL_REQUIRED: "1" } : {}),
				...(input.runBudget !== undefined ? { RUN_BUDGET: String(input.runBudget) } : {}),
				...(input.lookback !== undefined ? { LOOKBACK: String(input.lookback) } : {}),
				...(input.modelSnapshot ? { MODEL_SNAPSHOT: input.modelSnapshot } : {}),
				CREATED_AT: now,
				UPDATED_AT: now,
			}));
		} catch (error) {
			await store.removePrivateFiles([promptPath]);
			throw error;
		}
	});
	return parseSchedule(config, store, envPath);
}

export async function removeSchedule(config: CoasConfig, taskId: string): Promise<string> {
	assertSafeId("task id", taskId);
	const store = await ConfinedStore.createCoasHome(config);
	await store.removePrivateFiles([
		scheduleEnvPath(config, taskId),
		schedulePromptPath(config, taskId),
		scheduleRunsPath(config, taskId),
	]);
	await removeApprovalArtifactsForTask(config, taskId);
	return `coas-schedule: removed ${taskId}`;
}

async function readSchedule(config: CoasConfig, taskId: string): Promise<ScheduleEntry> {
	const store = await ConfinedStore.forScheduleRoot(config);
	const envPath = scheduleEnvPath(config, taskId);
	if (!await store.fileExists(envPath)) throw new Error(`Unknown schedule task: ${taskId}`);
	return parseSchedule(config, store, envPath);
}

async function logTask(config: CoasConfig, taskId: string, message: string): Promise<void> {
	const homeStore = await ConfinedStore.createCoasHome(config);
	await homeStore.ensurePrivateDir(scheduleLogRoot(config));
	const store = await ConfinedStore.forScheduleLogRoot(config);
	await store.appendPrivateLog(scheduleLogPath(config, taskId), `[${isoUtc()}] ${message}\n`);
}

export async function runSchedule(config: CoasConfig, taskId: string, dryRun: boolean): Promise<CommandResult> {
	const schedule = await readSchedule(config, taskId);
	const sessionDir = join(config.coasHome, "pi-sessions", "schedules", schedule.taskId);
	const logFile = scheduleLogPath(config, schedule.taskId);
	const lockPath = join(lockRoot(config), `${schedule.workspaceId}.lock`);
	const prompt = schedule.prompt ?? "";
	if (!schedule.enabled) return { code: 0, stdout: "", stderr: `coas-schedule: task disabled: ${schedule.taskId}` };
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
	return { code: 1, stdout: "", stderr: "coas-schedule: direct execution is disabled; enabled schedules run through the pi-hosted internal scheduler" };
}

export async function renderInternalSchedulePlan(config: CoasConfig): Promise<CommandResult> {
	const schedules = (await listSchedules(config)).filter((schedule) => schedule.enabled);
	const body = schedules.length > 0
		? schedules.map((schedule) => `${schedule.cronExpr} ${schedule.taskId} -> pi internal scheduler`).join("\n")
		: "no enabled CoAS schedules";
	return { code: 0, stderr: "", stdout: ["CoAS internal scheduler plan", "============================", body].join("\n") };
}
