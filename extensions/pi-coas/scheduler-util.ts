/**
 * Shared scheduler helpers: cron matching, tick keys, and run id generation.
 */
import { isoUtc } from "./store-paths.js";
export { scheduleMatchesDate } from "./scheduler-evaluation.js";

export function minuteKey(date: Date): string {
	return date.toISOString().slice(0, 16);
}

export function newRunId(): string {
	return `run-${isoUtc().replace(/[:T-]/g, "").toLowerCase()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}
