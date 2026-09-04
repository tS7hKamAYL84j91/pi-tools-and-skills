/**
 * Five-field cron matching for the daemon-ticked scheduler. Semantics match
 * the in-pi scheduler evaluation (minute hour day-of-month month day-of-week,
* `*`, lists, ranges, steps; day-of-week 0-7 with 7 == Sunday). Schedule files
 * are consumed unchanged (design doc: no schedule-file format change).
 */
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { assertSafeId } from "./paths.js";

export interface ScheduleEntry {
	readonly taskId: string;
	readonly taskName: string;
	readonly cronExpr: string;
	readonly enabled: boolean;
	readonly workspaceId: string;
	/** Additive M5 tag: defers delivery while a writer lease is held. */
	readonly writerTag?: "gravitas";
	readonly targetAgent?: string;
	readonly prompt: string;
}

export const SCHEDULE_FREQUENCY_CAP_MINUTES = 5;

export function cronExpressionError(expr: string): string | undefined {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) return `expected 5 fields, got ${fields.length}`;
	const ranges: ReadonlyArray<readonly [number, number]> = [
		[0, 59],
		[0, 23],
		[1, 31],
		[1, 12],
		[0, 7],
	];
	for (const [index, field] of fields.entries()) {
		const [min, max] = ranges[index] ?? [0, 59];
		if (field === "*") continue;
		for (const part of field.split(",")) {
			const stepMatch = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
			if (!stepMatch) return `invalid field ${index + 1}: ${field}`;
			const base = stepMatch[1] ?? "";
			const step = stepMatch[2] !== undefined ? Number.parseInt(stepMatch[2], 10) : 1;
			if (!Number.isInteger(step) || step < 1) return `invalid step in field ${index + 1}: ${field}`;
			if (base === "*") continue;
			const rangeMatch = /^(\d+)(?:-(\d+))?$/.exec(base);
			if (!rangeMatch) return `invalid field ${index + 1}: ${field}`;
			const start = Number.parseInt(rangeMatch[1] ?? "", 10);
			const end = rangeMatch[2] !== undefined ? Number.parseInt(rangeMatch[2], 10) : start;
			if (Number.isNaN(start) || Number.isNaN(end) || start < min || end > max || start > end) {
				return `field ${index + 1} out of range [${min}-${max}]: ${field}`;
			}
		}
	}
	return undefined;
}

/**
 * Design doc section 8 cap: the daemon refuses sub-5-minute schedules.
 * The minute field is expanded to its firing-minute set (lists, ranges,
 * steps) and adjacent firing minutes closer than the cap are refused —
 * comma lists cannot bypass the check (re-review B7).
 */
export function scheduleFrequencyCapError(expr: string, capMinutes = SCHEDULE_FREQUENCY_CAP_MINUTES): string | undefined {
	const fields = expr.trim().split(/\s+/);
	const minuteField = fields[0] ?? "";
	const minutes = new Set<number>();
	for (const part of minuteField.split(",")) {
		const stepMatch = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
		if (!stepMatch) return undefined; // malformed: cron validation reports it
		const base = stepMatch[1] ?? "";
		const step = stepMatch[2] !== undefined ? Number.parseInt(stepMatch[2], 10) : 1;
		if (base === "*") {
			for (let candidate = 0; candidate <= 59; candidate += step) minutes.add(candidate);
			continue;
		}
		const rangeMatch = /^(\d+)(?:-(\d+))?$/.exec(base);
		if (!rangeMatch) return undefined;
		const start = Number.parseInt(rangeMatch[1] ?? "0", 10);
		const end = rangeMatch[2] !== undefined ? Number.parseInt(rangeMatch[2], 10) : start;
		for (let candidate = start; candidate <= Math.min(end, 59); candidate += step) minutes.add(candidate);
	}
	if (minutes.size === 0) return undefined;
	const sorted = [...minutes].sort((first, second) => first - second);
	const capError = `schedule frequency below the ${capMinutes}-minute daemon cap (${minuteField})`;
	for (let i = 1; i < sorted.length; i++) {
		const gap = (sorted[i] ?? 0) - (sorted[i - 1] ?? 0);
		if (gap < capMinutes) return capError;
	}
	// Circular wrap: 59 -> 0+60.
	const last = sorted[sorted.length - 1] ?? 0;
	const first = sorted[0] ?? 0;
	if (60 - last + first < capMinutes) return capError;
	return undefined;
}

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
	if (field === "*") return true;
	for (const part of field.split(",")) {
		const stepMatch = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
		if (!stepMatch) continue;
		const base = stepMatch[1] ?? "";
		const step = stepMatch[2] !== undefined ? Number.parseInt(stepMatch[2], 10) : 1;
		if (base === "*") {
			for (let candidate = min; candidate <= max; candidate += step) {
				if (candidate === value) return true;
			}
			continue;
		}
		const rangeMatch = /^(\d+)(?:-(\d+))?$/.exec(base);
		if (!rangeMatch) continue;
		const start = Number.parseInt(rangeMatch[1] ?? "", 10);
		const end = rangeMatch[2] !== undefined ? Number.parseInt(rangeMatch[2], 10) : start;
		for (let candidate = start; candidate <= end; candidate += step) {
			if (candidate === value) return true;
		}
	}
	return false;
}

/** Wall-clock match (minute granularity); day-of-week 0 and 7 are both Sunday. */
export function scheduleMatchesDate(expr: string, date: Date): boolean {
	if (cronExpressionError(expr) !== undefined) return false;
	const fields = expr.trim().split(/\s+/);
	const minute = fields[0] ?? "*";
	const hour = fields[1] ?? "*";
	const dayOfMonth = fields[2] ?? "*";
	const month = fields[3] ?? "*";
	const dayOfWeek = fields[4] ?? "*";
	return (
		fieldMatches(minute, date.getMinutes(), 0, 59) &&
		fieldMatches(hour, date.getHours(), 0, 23) &&
		fieldMatches(month, date.getMonth() + 1, 1, 12) &&
		fieldMatches(dayOfMonth, date.getDate(), 1, 31) &&
		(fieldMatches(dayOfWeek, date.getDay(), 0, 7) || (date.getDay() === 0 && fieldMatches(dayOfWeek, 7, 0, 7)))
	);
}

type RawScheduleEnv = {
	readonly TASK_ID?: string;
	readonly TASK_NAME?: string;
	readonly CRON_EXPR?: string;
	readonly ENABLED?: string;
	readonly WORKSPACE_ID?: string;
	readonly WRITER_TAG?: string;
	readonly TARGET_AGENT?: string;
};

function parseEnvLine(content: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const index = trimmed.indexOf("=");
		if (index <= 0) continue;
		const key = trimmed.slice(0, index);
		if (/^[A-Z0-9_]+$/.test(key)) {
			let value = trimmed.slice(index + 1).trim();
			if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
				value = value.slice(1, -1);
			}
			values[key] = value;
		}
	}
	return values;
}

/**
 * Load schedule entries from a CoAS home's schedules directory (files are
 * consumed unchanged). Invalid crons, sub-5-minute frequencies, and unsafe
 * ids are refused with an audit event — never silently skipped.
 */
export async function loadSchedules(coasSchedulesDir: string, audit?: (event: Record<string, unknown>) => Promise<void>): Promise<ScheduleEntry[]> {
	const { readdir } = await import("node:fs/promises");
	const entries: ScheduleEntry[] = [];
	let files: string[] = [];
	try {
		files = (await readdir(coasSchedulesDir, { withFileTypes: true }))
			.filter((entry) => entry.isFile() && entry.name.endsWith(".env"))
			.map((entry) => entry.name);
	} catch {
		return entries;
	}
	for (const file of files) {
		try {
			const parsed = parseEnvLine(await readFile(join(coasSchedulesDir, file), "utf8")) as RawScheduleEnv;
			const taskId = parsed.TASK_ID ?? file.replace(/\.env$/, "");
			assertSafeId("task id", taskId);
			if (parsed.WORKSPACE_ID !== undefined) assertSafeId("workspace id", parsed.WORKSPACE_ID);
			const cronExpr = parsed.CRON_EXPR ?? "";
			const cronError = cronExpressionError(cronExpr);
			if (cronError !== undefined) {
				await audit?.({ kind: "schedule_refused", file, reason: cronError });
				continue;
			}
			const capError = scheduleFrequencyCapError(cronExpr);
			if (capError !== undefined) {
				await audit?.({ kind: "schedule_refused", file, reason: capError });
				continue;
			}
			entries.push({
				taskId,
				taskName: parsed.TASK_NAME ?? taskId,
				cronExpr,
				enabled: (parsed.ENABLED ?? "1") === "1",
				workspaceId: parsed.WORKSPACE_ID ?? "",
				...(parsed.WRITER_TAG === "gravitas" ? { writerTag: "gravitas" as const } : {}),
				...(parsed.TARGET_AGENT !== undefined ? { targetAgent: parsed.TARGET_AGENT } : {}),
				prompt: "",
			});
		} catch (error) {
			await audit?.({ kind: "schedule_refused", file, reason: (error as Error).message });
		}
	}
	return entries.sort((first, second) => first.taskId.localeCompare(second.taskId));
}

/** Load the prompt body for a task (separate .prompt file, consumed unchanged). */
export async function loadSchedulePrompt(coasSchedulesDir: string, taskId: string): Promise<string | undefined> {
	try {
		assertSafeId("task id", taskId);
		return await readFile(join(coasSchedulesDir, `${taskId}.prompt`), "utf8");
	} catch {
		return undefined;
	}
}