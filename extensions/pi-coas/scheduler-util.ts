/**
 * Shared scheduler helpers: cron matching, tick keys, and run id generation.
 */
import { isoUtc } from "./store-paths.js";
export { scheduleMatchesDate } from "./scheduler-evaluation.js";

interface ModelIdentity {
	readonly provider: string;
	readonly id: string;
}

/** Stable model identity label (`provider/id`) used for drift snapshots. */
export function formatModelLabel(model: ModelIdentity | undefined): string | undefined {
	if (!model?.provider || !model.id) return undefined;
	return `${model.provider}/${model.id}`;
}

export function minuteKey(date: Date): string {
	return date.toISOString().slice(0, 16);
}

export function newRunId(): string {
	return `run-${isoUtc().replace(/[:T-]/g, "").toLowerCase()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}
