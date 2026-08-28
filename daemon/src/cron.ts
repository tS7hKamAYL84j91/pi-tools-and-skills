/**
 * Five-field cron matching for the daemon-ticked scheduler. Semantics match
 * the in-pi scheduler evaluation (minute hour day-of-month month day-of-week,
 * `*`, lists, ranges, steps). Schedule files are consumed unchanged (design
 * doc: no schedule-file format change).
 */
import { join } from "node:path";
import { readFile } from "node:fs/promises";

export interface ScheduleEntry {
	readonly taskId: string;
	readonly taskName: string;
	readonly cronExpr: string;
	readonly enabled: boolean;
	readonly workspaceId: string;
	/** Additive M5 tag: defers delivery while a writer lease is held. */
	readonly writerTag?: "gravitas";
	readonly prompt: string;
}

export function cronExpressionError(expr: string): string | undefined {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) return `expected 5 fields, got ${fields.length}`;
	const ranges: ReadonlyArray<readonly [number, number]> = [
		[0, 59],
		[0, 23],
		[1, 31],
		[1, 12],
		[0, 6],
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

/** Wall-clock match (minute granularity). */
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
		fieldMatches(dayOfWeek, date.getDay(), 0, 6)
	);
}

interface RawScheduleEnv {
	readonly TASK_ID?: string;
	readonly TASK_NAME?: string;
	readonly CRON_EXPR?: string;
	readonly ENABLED?: string;
	readonly WORKSPACE_ID?: string;
	readonly WRITER_TAG?: string;
}

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
 * consumed unchanged). Enablement, cron validity, and the additive writer
 * tag are read here; the tick owns the rest.
 */
export async function loadSchedules(coasSchedulesDir: string): Promise<ScheduleEntry[]> {
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
			const cronExpr = parsed.CRON_EXPR ?? "";
			if (cronExpressionError(cronExpr) !== undefined) continue;
			entries.push({
				taskId,
				taskName: parsed.TASK_NAME ?? taskId,
				cronExpr,
				enabled: (parsed.ENABLED ?? "1") === "1",
				workspaceId: parsed.WORKSPACE_ID ?? "",
				...(parsed.WRITER_TAG === "gravitas" ? { writerTag: "gravitas" as const } : {}),
				prompt: "",
			});
		} catch {
			continue;
		}
	}
	return entries.sort((first, second) => first.taskId.localeCompare(second.taskId));
}

/** Load the prompt body for a task (separate .prompt file, consumed unchanged). */
export async function loadSchedulePrompt(coasSchedulesDir: string, taskId: string): Promise<string | undefined> {
	try {
		return await readFile(join(coasSchedulesDir, `${taskId}.prompt`), "utf8");
	} catch {
		return undefined;
	}
}