/** Tests for timer occurrence math and declared-fact construction (SPEC §8, §12). */

import { describe, expect, it } from "vitest";
import {
	TIMER_LIMITS,
	TIMER_PROFILE,
} from "../../../tests/fixtures/pi-event-loop.js";
import {
	buildTimerEvent,
	latestMissedIntervalOccurrenceMs,
	nextDailyOccurrenceMs,
} from "../timer-schedule.js";
import { deriveEventId } from "../types.js";

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

describe("buildTimerEvent", () => {
	const host = {
		profileName: "default",
		profile: TIMER_PROFILE,
		limits: TIMER_LIMITS,
		now: () => 1_000,
	};

	it("builds the declared fact with timer identity sha256(profile + timerId + scheduledFor) (SPEC §8, §12)", () => {
		const spec = TIMER_PROFILE.timers[0];
		if (spec === undefined) {
			throw new Error("fixture broken: timer missing");
		}
		const event = buildTimerEvent(host, spec, 3_600_000);
		expect(event).toBeDefined();
		const scheduledFor = new Date(3_600_000).toISOString();
		expect(event?.source).toBe("timer");
		expect(event?.type).toBe("progress.review-became-due");
		expect(event?.payload).toEqual({ scheduledFor });
		expect(event?.eventId).toBe(
			deriveEventId("default", spec.id, scheduledFor),
		);
	});

	it("returns undefined when the emit event is undeclared or its payload contract fails", () => {
		const broken = TIMER_PROFILE.timers[2];
		if (broken === undefined) {
			throw new Error("fixture broken: timer missing");
		}
		expect(buildTimerEvent(host, broken, 1_000)).toBeUndefined();
		const unknownEmit: typeof broken = { ...broken, emit: "no-such-event" };
		expect(buildTimerEvent(host, unknownEmit, 1_000)).toBeUndefined();
	});
});

describe("latestMissedIntervalOccurrenceMs", () => {
	it("returns the latest missed occurrence only (AC-17)", () => {
		const last = 0;
		const now = 2.5 * HOUR_MS;
		expect(latestMissedIntervalOccurrenceMs(60, last, now)).toBe(2 * HOUR_MS);
		expect(latestMissedIntervalOccurrenceMs(60, last, HOUR_MS)).toBe(HOUR_MS);
		expect(
			latestMissedIntervalOccurrenceMs(60, last, 0.5 * HOUR_MS),
		).toBeUndefined();
	});

	it("never derives catch-up from a missing last-fired timestamp (SPEC §12)", () => {
		expect(
			latestMissedIntervalOccurrenceMs(60, undefined, 100 * HOUR_MS),
		).toBeUndefined();
	});
});

describe("nextDailyOccurrenceMs", () => {
	it("schedules today's slot when still ahead, otherwise tomorrow's", () => {
		const morning = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();
		const expectedToday = new Date(2026, 0, 5, 9, 30, 0, 0).getTime();
		expect(nextDailyOccurrenceMs("09:30", undefined, morning)).toBe(
			expectedToday,
		);
		expect(nextDailyOccurrenceMs("09:30", undefined, expectedToday + 1)).toBe(
			expectedToday + DAY_MS,
		);
	});

	it("skips to tomorrow when today's slot already fired", () => {
		const expectedToday = new Date(2026, 0, 5, 9, 30, 0, 0).getTime();
		expect(
			nextDailyOccurrenceMs("09:30", "2026-01-05", expectedToday - 1),
		).toBe(expectedToday + DAY_MS);
	});

	it("preserves local wall-clock time across DST transitions (SPEC §12)", () => {
		// March 28 -> March 29, 2026 is a 23-hour day in Europe/London (+0000 -> +0100).
		const springEve = new Date(2026, 2, 28, 9, 30, 0, 0).getTime();
		const nextSpring = nextDailyOccurrenceMs("09:30", "2026-03-28", springEve);
		const springTarget = new Date(nextSpring);
		expect(springTarget.getHours()).toBe(9);
		expect(springTarget.getMinutes()).toBe(30);

		// October 24 -> October 25, 2026 is a 25-hour day in Europe/London (+0100 -> +0000).
		const fallEve = new Date(2026, 9, 24, 9, 30, 0, 0).getTime();
		const nextFall = nextDailyOccurrenceMs("09:30", "2026-10-24", fallEve);
		const fallTarget = new Date(nextFall);
		expect(fallTarget.getHours()).toBe(9);
		expect(fallTarget.getMinutes()).toBe(30);
	});
});
