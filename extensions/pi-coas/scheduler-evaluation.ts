/** Pure schedule evaluation helpers shared by the registry and internal scheduler. */

import type { ScheduleEntry } from "./types.js";

interface CronFieldSpec {
	values?: Set<number>;
	any: boolean;
}

function parseCronField(field: string, min: number, max: number): CronFieldSpec {
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
	if (fields.length !== 5 || fields.some((field) => field.length === 0)) return "Cron expression must have exactly five fields";
	const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
	return cronFieldError("minute", minute ?? "", 0, 59) ??
		cronFieldError("hour", hour ?? "", 0, 23) ??
		cronFieldError("day-of-month", dayOfMonth ?? "", 1, 31) ??
		cronFieldError("month", month ?? "", 1, 12) ??
		cronFieldError("day-of-week", dayOfWeek ?? "", 0, 7);
}

export function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
	const spec = parseCronField(field, min, max);
	return spec.any || Boolean(spec.values?.has(value));
}

export function validateCronExpr(expr: string): void {
	const error = cronExpressionError(expr);
	if (error) throw new Error(error);
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

export function countContinuationSchedules(schedules: readonly ScheduleEntry[]): number {
	return schedules.filter((schedule) => schedule.continuation).length;
}
