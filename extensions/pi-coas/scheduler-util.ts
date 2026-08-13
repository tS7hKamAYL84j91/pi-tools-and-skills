/**
 * Shared scheduler helpers: cron matching, tick keys, and run id generation.
 */
import { isoUtc } from "./store-paths.js";
import { cronExpressionError, cronFieldMatches } from "./schedules.js";

export function minuteKey(date: Date): string {
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

export function newRunId(): string {
	return `run-${isoUtc().replace(/[:T-]/g, "").toLowerCase()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}
