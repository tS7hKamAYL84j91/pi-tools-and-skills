/** Narrowing of individual snapshot records: work items, commands, timer state (SPEC §15). */

import { isNonEmptyString, isRecord, isStringArray } from "./config-guards.js";
import type {
	CommandRecord,
	CommandStatus,
	TimerOccurrenceState,
	TodoItem,
	TodoStatus,
} from "./types.js";

const TODO_STATUSES: readonly TodoStatus[] = [
	"outstanding",
	"dispatched",
	"completed",
	"stalled",
];

const COMMAND_STATUSES: readonly CommandStatus[] = [
	"queued",
	"active",
	"delivered",
	"settled",
	"cancelled",
];

const TODO_STRING_FIELDS = [
	"workItemId",
	"viewId",
	"key",
	"openedByEventId",
] as const;

const COMMAND_STRING_FIELDS = [
	"commandId",
	"type",
	"automationId",
	"workItemId",
	"viewId",
	"correlationId",
	"causedBy",
	"message",
] as const;

/** Collect the required string fields; undefined when any is missing or not a string. */
function asRequiredStrings<F extends string>(
	raw: Record<string, unknown>,
	fields: readonly F[],
): Record<F, string> | undefined {
	const values: Partial<Record<F, string>> = {};
	for (const field of fields) {
		const value = raw[field];
		if (!isNonEmptyString(value)) {
			return undefined;
		}
		// The assertion is justified: every listed field was validated as a non-empty
		// string directly above, so the record is complete when returned.
		(values as Record<F, string>)[field] = value;
	}
	return values as Record<F, string>;
}

function asTodoStatus(value: unknown): TodoStatus | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	return (TODO_STATUSES as readonly string[]).includes(value)
		? (value as TodoStatus)
		: undefined;
}

function asCommandStatus(value: unknown): CommandStatus | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	return (COMMAND_STATUSES as readonly string[]).includes(value)
		? (value as CommandStatus)
		: undefined;
}

export function asTodoItems(raw: unknown): readonly TodoItem[] | undefined {
	if (!Array.isArray(raw)) {
		return undefined;
	}
	const items: TodoItem[] = [];
	for (const entry of raw) {
		const item = asTodoItem(entry);
		if (item === undefined) {
			return undefined;
		}
		items.push(item);
	}
	return items;
}

export function asCommandRecords(
	raw: unknown,
): readonly CommandRecord[] | undefined {
	if (!Array.isArray(raw)) {
		return undefined;
	}
	const records: CommandRecord[] = [];
	for (const entry of raw) {
		const record = asCommandRecord(entry);
		if (record === undefined) {
			return undefined;
		}
		records.push(record);
	}
	return records;
}

function asTodoItem(raw: unknown): TodoItem | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const status = asTodoStatus(raw.status);
	const strings = asRequiredStrings(raw, TODO_STRING_FIELDS);
	if (
		status === undefined ||
		strings === undefined ||
		!isRecord(raw.sourcePayload)
	) {
		return undefined;
	}
	const item: TodoItem = {
		workItemId: strings.workItemId,
		viewId: strings.viewId,
		key: strings.key,
		openedByEventId: strings.openedByEventId,
		sourcePayload: raw.sourcePayload,
		status,
	};
	const commandId = raw.commandId;
	const completedByEventId = raw.completedByEventId;
	if (typeof commandId === "string") {
		(item as { commandId?: string }).commandId = commandId;
	}
	if (typeof completedByEventId === "string") {
		(item as { completedByEventId?: string }).completedByEventId =
			completedByEventId;
	}
	return item;
}

export function asCommandRecord(raw: unknown): CommandRecord | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const strings = asRequiredStrings(raw, COMMAND_STRING_FIELDS);
	const status = asCommandStatus(raw.status);
	if (strings === undefined || status === undefined) {
		return undefined;
	}
	if (!isStringArray(raw.expectedEvents) || !isRecord(raw.workItem)) {
		return undefined;
	}
	return {
		commandId: strings.commandId,
		type: strings.type,
		automationId: strings.automationId,
		workItemId: strings.workItemId,
		viewId: strings.viewId,
		correlationId: strings.correlationId,
		causedBy: strings.causedBy,
		message: strings.message,
		expectedEvents: raw.expectedEvents,
		workItem: raw.workItem,
		status,
	};
}

/** Mutable construction shape for one timer state entry (fields are readonly once stored). */
interface MutableTimerState {
	lastIntervalFiredAt?: number;
	lastDailyDate?: string;
}

export function asTimerState(
	raw: unknown,
): Record<string, TimerOccurrenceState> | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const state: Record<string, TimerOccurrenceState> = {};
	for (const [timerId, value] of Object.entries(raw)) {
		if (!isRecord(value)) {
			return undefined;
		}
		const lastIntervalFiredAt = value.lastIntervalFiredAt;
		const lastDailyDate = value.lastDailyDate;
		if (
			lastIntervalFiredAt !== undefined &&
			typeof lastIntervalFiredAt !== "number"
		) {
			return undefined;
		}
		if (lastDailyDate !== undefined && !isNonEmptyString(lastDailyDate)) {
			return undefined;
		}
		const entry: MutableTimerState = {};
		if (typeof lastIntervalFiredAt === "number") {
			entry.lastIntervalFiredAt = lastIntervalFiredAt;
		}
		if (isNonEmptyString(lastDailyDate)) {
			entry.lastDailyDate = lastDailyDate;
		}
		state[timerId] = entry;
	}
	return state;
}
