/**
 * TypeScript CoAS status and diagnostics.
 */

import { existsSync } from "node:fs";
import { constants } from "node:fs";
import { access, readdir, readFile, stat, statfs } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { listSchedules, validateCronExpr } from "./schedules.js";
import {
	assertInside,
	assertSafeId,
	countDirectories,
	fileExists,
	lockRoot,
	logRoot,
	newestFile,
	parseEnv,
	scheduleLogRoot,
	workspaceRoot,
} from "./store.js";
import type { CoasConfig, CommandResult, DoctorCheck } from "./types.js";

function statusLine(label: string, value: string | number): string {
	return `${label.padEnd(18)} ${value}`;
}

async function commandExists(name: string): Promise<boolean> {
	for (const dir of (process.env.PATH ?? "").split(":")) {
		if (!dir) continue;
		try {
			await access(join(dir, name), constants.X_OK);
			return true;
		} catch {
			// Keep looking.
		}
	}
	return false;
}

async function checkCommand(name: string, critical = false): Promise<DoctorCheck> {
	if (await commandExists(name)) return { level: "ok", message: `command '${name}' available` };
	return { level: critical ? "critical" : "warn", message: `command '${name}' missing` };
}

async function lastScheduleSignal(config: CoasConfig): Promise<string> {
	const latest = await newestFile(scheduleLogRoot(config), ".log");
	if (!latest) return "none";
	const lines = (await readFile(latest, "utf8")).trim().split("\n").slice(-5);
	for (const line of [...lines].reverse()) {
		if (/FAILED|SKIP|OK/.test(line)) return line;
	}
	return `see ${latest}`;
}

export async function coasStatus(config: CoasConfig): Promise<CommandResult> {
	const schedules = await listSchedules(config).catch(() => []);
	const lines = [
		"CoAS status",
		"===========",
		statusLine("data root", config.coasHome),
		statusLine("workspaces", await countDirectories(workspaceRoot(config))),
		statusLine("enabled schedules", schedules.filter((schedule) => schedule.enabled).length),
		statusLine("last schedule", await lastScheduleSignal(config)),
		statusLine("logs", existsSync(logRoot(config)) ? logRoot(config) : "none"),
		statusLine("doctor", "run: /coas-doctor"),
	];
	return { stdout: lines.join("\n"), stderr: "", code: 0 };
}

async function checkWorkspaceRegistry(config: CoasConfig): Promise<DoctorCheck[]> {
	const checks: DoctorCheck[] = [];
	const root = workspaceRoot(config);
	if (!existsSync(root)) {
		checks.push({ level: "ok", message: `workspace registry: none at ${root}` });
		return checks;
	}
	const entries = await readdir(root, { withFileTypes: true });
	let bad = 0;
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const dir = join(root, entry.name);
		if (!await fileExists(join(dir, "CONTEXT.md"))) {
			checks.push({ level: "warn", message: `workspace missing CONTEXT.md: ${dir}` });
			bad++;
		}
		if (!await fileExists(join(dir, ".coas", "workspace.env"))) {
			checks.push({ level: "warn", message: `workspace missing metadata: ${dir}` });
			bad++;
		}
	}
	checks.push({
		level: "ok",
		message: bad === 0 ? `workspace metadata consistent at ${root}` : `workspace registry checked at ${root}`,
	});
	return checks;
}

async function checkSchedules(config: CoasConfig): Promise<DoctorCheck[]> {
	const checks: DoctorCheck[] = [];
	const root = join(config.coasHome, "schedules");
	if (!existsSync(root)) return [{ level: "ok", message: "schedule registry: none" }];
	const entries = await readdir(root, { withFileTypes: true });
	let count = 0;
	let bad = 0;
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".env")) continue;
		count++;
		const envPath = join(root, entry.name);
		const values = parseEnv(await readFile(envPath, "utf8"));
		const taskId = values.TASK_ID ?? entry.name.replace(/\.env$/, "");
		try {
			if (!values.TASK_ID || !values.CRON_EXPR || !values.PROMPT_FILE) throw new Error("missing required field");
			assertSafeId("task id", values.TASK_ID);
			assertSafeId("workspace id", values.WORKSPACE_ID ?? "missing");
			validateCronExpr(values.CRON_EXPR);
			assertInside(root, values.PROMPT_FILE);
			if (!await fileExists(values.PROMPT_FILE)) throw new Error(`prompt missing: ${values.PROMPT_FILE}`);
		} catch (error) {
			bad++;
			checks.push({ level: "warn", message: `invalid schedule ${taskId}: ${(error as Error).message}` });
		}
	}
	checks.push({ level: "ok", message: `schedule registry: ${count} schedule(s), ${bad} invalid` });
	return checks;
}

async function checkRecentScheduleFailures(config: CoasConfig): Promise<DoctorCheck[]> {
	const root = scheduleLogRoot(config);
	if (!existsSync(root)) return [{ level: "ok", message: "schedule logs: none" }];
	const entries = await readdir(root, { withFileTypes: true });
	const failures: string[] = [];
	const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".log")) continue;
		const path = join(root, entry.name);
		const info = await stat(path);
		if (info.mtimeMs < weekAgo) continue;
		const text = await readFile(path, "utf8");
		for (const line of text.split("\n")) {
			if (/FAILED|SKIP busy/.test(line)) failures.push(`${entry.name}: ${line}`);
		}
	}
	if (failures.length === 0) return [{ level: "ok", message: "no recent schedule failures" }];
	return [{ level: "warn", message: `recent schedule failures/skips detected: ${failures.slice(-5).join("; ")}` }];
}

async function checkScheduleLocks(config: CoasConfig): Promise<DoctorCheck[]> {
	const root = lockRoot(config);
	if (!existsSync(root)) return [{ level: "ok", message: "schedule locks: none" }];
	const entries = await readdir(root, { withFileTypes: true });
	let total = 0;
	let bad = 0;
	const nowSeconds = Math.floor(Date.now() / 1000);
	const staleAfterSeconds = Number.parseInt(process.env.COAS_SCHEDULE_LOCK_STALE_SECONDS ?? "86400", 10);
	const localHost = hostname();
	for (const entry of entries) {
		if (!entry.isDirectory() || !entry.name.endsWith(".lock")) continue;
		total++;
		const lockPath = join(root, entry.name);
		const pidText = (await readFile(join(lockPath, "pid"), "utf8").catch(() => "")).trim();
		const hostText = (await readFile(join(lockPath, "host"), "utf8").catch(() => "")).trim();
		const startedText = (await readFile(join(lockPath, "started_epoch"), "utf8").catch(() => "")).trim();
		if (!pidText || !/^\d+$/.test(startedText)) {
			bad++;
			continue;
		}
		const pid = Number.parseInt(pidText, 10);
		if (hostText === localHost) {
			try {
				process.kill(pid, 0);
			} catch {
				bad++;
				continue;
			}
		}
		const ageSeconds = nowSeconds - Number.parseInt(startedText, 10);
		if (ageSeconds > staleAfterSeconds) bad++;
	}
	if (total === 0) return [{ level: "ok", message: "schedule locks: none" }];
	return [{ level: bad === 0 ? "ok" : "warn", message: `schedule locks: ${total} lock(s), ${bad} stale/malformed` }];
}

async function checkDisk(config: CoasConfig): Promise<DoctorCheck[]> {
	try {
		const info = await stat(config.coasHome);
		if (!info.isDirectory()) return [{ level: "critical", message: `data root not directory: ${config.coasHome}` }];
		const fsInfo = await statfs(config.coasHome);
		const freeKb = Math.floor((fsInfo.bavail * fsInfo.bsize) / 1024);
		const diskLevel: DoctorCheck["level"] = freeKb < 1048576 ? "warn" : "ok";
		return [
			{ level: "ok", message: `data root directory: ${config.coasHome}` },
			{ level: diskLevel, message: `disk space under ${config.coasHome}: ${freeKb} KB available` },
		];
	} catch {
		return [{ level: "warn", message: `data root does not exist yet: ${config.coasHome}` }];
	}
}

export async function coasDoctor(config: CoasConfig): Promise<CommandResult> {
	const checks = [
		await checkCommand("pi", true),
		await checkCommand("docker"),
		await checkCommand("crontab"),
		...(await checkDisk(config)),
		...(await checkWorkspaceRegistry(config)),
		...(await checkSchedules(config)),
		...(await checkRecentScheduleFailures(config)),
		...(await checkScheduleLocks(config)),
	];
	const warnings = checks.filter((check) => check.level === "warn").length;
	const criticals = checks.filter((check) => check.level === "critical").length;
	const lines = [
		"CoAS doctor",
		"===========",
		...checks.map((check) => `${check.level === "ok" ? "✓" : check.level === "warn" ? "⚠" : "✗"} ${check.message}`),
	];
	const code = criticals > 0 ? 2 : warnings > 0 ? 1 : 0;
	const stderr = criticals > 0
		? `coas-doctor: ${criticals} critical, ${warnings} warning(s)`
		: warnings > 0
			? `coas-doctor: ${warnings} warning(s)`
			: "coas-doctor: healthy";
	return { stdout: lines.join("\n"), stderr, code };
}
