/** Tests for the pi-event-loop event log over custom session entries (SPEC §8). */

import { describe, expect, it } from "vitest";

import {
	asLoopEventData,
	buildEventIndex,
	readEventLog,
	type SessionEntryLike,
} from "../event-log.js";
import { EVENT_LOOP_EVENT_CUSTOM_TYPE, type LoopEventData } from "../types.js";

function eventEntry(overrides: Partial<LoopEventData> = {}): SessionEntryLike {
	return {
		type: "custom",
		customType: EVENT_LOOP_EVENT_CUSTOM_TYPE,
		data: {
			eventId: "evt-1",
			type: "work.completed",
			occurredAt: "2026-09-04T14:00:00Z",
			source: "agent",
			payload: { workId: "work-42" },
			...overrides,
		},
	};
}

describe("event log", () => {
	it("reads events in branch order from custom entries", () => {
		const entries: SessionEntryLike[] = [
			{ type: "message" },
			eventEntry({ eventId: "evt-1" }),
			{ type: "custom", customType: "other-extension", data: { x: 1 } },
			eventEntry({ eventId: "evt-2", type: "review.accepted" }),
		];
		const events = readEventLog(entries);
		expect(events.map((event) => event.eventId)).toEqual(["evt-1", "evt-2"]);
	});

	it("ignores malformed event entries instead of failing the whole log", () => {
		const entries: SessionEntryLike[] = [
			{
				type: "custom",
				customType: EVENT_LOOP_EVENT_CUSTOM_TYPE,
				data: { eventId: "evt-broken" },
			},
			eventEntry({ eventId: "evt-2" }),
		];
		const events = readEventLog(entries);
		expect(events.map((event) => event.eventId)).toEqual(["evt-2"]);
	});

	it("narrowing accepts well-formed events and rejects bad shapes", () => {
		expect(
			asLoopEventData({
				eventId: "evt-1",
				type: "t",
				occurredAt: "x",
				source: "agent",
				payload: {},
			}),
		).toBeDefined();
		expect(
			asLoopEventData({
				eventId: "evt-1",
				type: "t",
				occurredAt: "x",
				source: "alien",
				payload: {},
			}),
		).toBeUndefined();
		expect(
			asLoopEventData({
				eventId: "evt-1",
				type: "t",
				occurredAt: "x",
				source: "agent",
			}),
		).toBeUndefined();
		expect(asLoopEventData(null)).toBeUndefined();
	});

	it("builds an index keyed by deterministic event id", () => {
		const events = readEventLog([
			eventEntry({ eventId: "evt-a" }),
			eventEntry({ eventId: "evt-b" }),
		]);
		const index = buildEventIndex(events);
		expect(index.get("evt-a")?.type).toBe("work.completed");
		expect(index.size).toBe(2);
	});
});
