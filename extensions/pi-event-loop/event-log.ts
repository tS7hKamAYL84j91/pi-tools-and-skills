/** Immutable event log over custom Pi session entries (SPEC §8). */
import {
	EVENT_LOOP_EVENT_CUSTOM_TYPE,
	type EventSource,
	type LoopEventData,
} from "./types.js";

/** Structural subset of a Pi session entry; keeps this module testable without the Pi runtime. */
export interface SessionEntryLike {
	readonly type: string;
	readonly customType?: unknown;
	readonly data?: unknown;
}

const EVENT_SOURCES: readonly EventSource[] = [
	"agent",
	"operator",
	"timer",
	"system",
];

function isEventSource(value: unknown): value is EventSource {
	return (
		typeof value === "string" &&
		(EVENT_SOURCES as readonly string[]).includes(value)
	);
}

/** Narrow stored entry data to a well-formed event; malformed entries are ignored, not repaired. */
export function asLoopEventData(data: unknown): LoopEventData | undefined {
	if (typeof data !== "object" || data === null) {
		return undefined;
	}
	const record = data as Record<string, unknown>;
	if (
		typeof record["eventId"] !== "string" ||
		typeof record["type"] !== "string" ||
		typeof record["occurredAt"] !== "string" ||
		!isEventSource(record["source"]) ||
		typeof record["payload"] !== "object" ||
		record["payload"] === null
	) {
		return undefined;
	}
	const payload = record["payload"] as Record<string, unknown>;
	const event: LoopEventData = {
		eventId: record["eventId"],
		type: record["type"],
		occurredAt: record["occurredAt"],
		source: record["source"],
		payload,
	};
	for (const optionalField of [
		"commandId",
		"workItemId",
		"correlationId",
		"causationId",
	] as const) {
		const value = record[optionalField];
		if (typeof value === "string") {
			(event as Record<typeof optionalField, string>)[optionalField] = value;
		}
	}
	return event;
}

/** Read events in branch order; the session log is the source of truth. */
export function readEventLog(
	entries: readonly SessionEntryLike[],
): readonly LoopEventData[] {
	const events: LoopEventData[] = [];
	for (const entry of entries) {
		if (
			entry.type !== "custom" ||
			entry.customType !== EVENT_LOOP_EVENT_CUSTOM_TYPE
		) {
			continue;
		}
		const event = asLoopEventData(entry.data);
		if (event !== undefined) {
			events.push(event);
		}
	}
	return events;
}

/** Index events by their deterministic ID for duplicate detection. */
export function buildEventIndex(
	events: readonly LoopEventData[],
): ReadonlyMap<string, LoopEventData> {
	const index = new Map<string, LoopEventData>();
	for (const event of events) {
		index.set(event.eventId, event);
	}
	return index;
}
