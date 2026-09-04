/** Timer validator for .pi/event-loop.json (SPEC §6, §12, §18). */
import type { TimerSpec } from "./types.js";
import { checkUnknownKeys, isNonEmptyString, isPositiveInteger, isRecord } from "./config-guards.js";

const TIMER_KEYS = ["id", "intervalMinutes", "dailyAt", "emit"] as const;
const DAILY_AT_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function validateTimer(
	path: string,
	raw: unknown,
	errors: string[],
): TimerSpec | undefined {
	if (!isRecord(raw)) {
		errors.push(`${path}: must be an object`);
		return undefined;
	}
	let valid = checkUnknownKeys(raw, TIMER_KEYS, path, errors);

	const id = raw["id"];
	const emit = raw["emit"];
	if (!isNonEmptyString(id)) {
		errors.push(`${path}: "id" must be a non-empty string`);
		valid = false;
	}
	if (!isNonEmptyString(emit)) {
		errors.push(`${path}: "emit" must be a non-empty string`);
		valid = false;
	}

	const intervalMinutes = raw["intervalMinutes"];
	const dailyAt = raw["dailyAt"];
	const hasInterval = intervalMinutes !== undefined;
	const hasDaily = dailyAt !== undefined;
	if (hasInterval && hasDaily) {
		errors.push(
			`${path}: "intervalMinutes" and "dailyAt" are mutually exclusive`,
		);
		valid = false;
	}
	if (!hasInterval && !hasDaily) {
		errors.push(
			`${path}: timers require either "intervalMinutes" or "dailyAt"`,
		);
		valid = false;
	}
	if (hasInterval && !isPositiveInteger(intervalMinutes)) {
		errors.push(`${path}: "intervalMinutes" must be a positive integer`);
		valid = false;
	}
	if (
		hasDaily &&
		(typeof dailyAt !== "string" || !DAILY_AT_PATTERN.test(dailyAt))
	) {
		errors.push(
			`${path}: "dailyAt" must be "HH:MM" between 00:00 and 23:59 in the host timezone`,
		);
		valid = false;
	}

	if (!valid || !isNonEmptyString(id) || !isNonEmptyString(emit)) {
		return undefined;
	}
	if (isPositiveInteger(intervalMinutes)) {
		return { id, emit, intervalMinutes };
	}
	if (typeof dailyAt === "string") {
		return { id, emit, dailyAt };
	}
	return { id, emit };
}