/** Tests for the timer runner: occurrence emission and handle lifecycle (SPEC §12). */

import { describe, expect, it } from "vitest";
import {
	TIMER_LIMITS,
	TIMER_PROFILE,
} from "../../../tests/fixtures/pi-event-loop.js";
import type { TimerHandle, TimerHost } from "../timer-schedule.js";
import { createTimerRunner } from "../timers.js";
import type { LoopEventData, TimerOccurrenceState } from "../types.js";
import { deriveEventId } from "../types.js";

const HOUR_MS = 60 * 60_000;

interface FakeScheduledTimer {
	callback: () => void;
	readonly delayMs: number;
	cleared: boolean;
}

interface FakeRunnerHost {
	readonly timers: FakeScheduledTimer[];
	readonly appended: LoopEventData[];
	readonly notified: string[];
	readonly host: TimerHost;
	readonly pending: () => number;
	readonly setClock: (nowMs: number) => void;
	/** Simulate the runtime firing a one-shot timer: the handle is done afterwards. */
	readonly fire: (timer: FakeScheduledTimer) => void;
}

function fakeHost(
	startMs: number,
	knownEventIds: readonly string[] = [],
	onAppend?: (event: LoopEventData) => void,
): FakeRunnerHost {
	const timers: FakeScheduledTimer[] = [];
	const appended: LoopEventData[] = [];
	const notified: string[] = [];
	let clock = startMs;
	const handles = new Map<TimerHandle, FakeScheduledTimer>();
	const host: TimerHost = {
		profileName: "default",
		profile: TIMER_PROFILE,
		limits: TIMER_LIMITS,
		knownEventIds: () => new Set(knownEventIds),
		appendEvent: (event) => {
			if (onAppend !== undefined) {
				onAppend(event);
			} else {
				appended.push(event);
			}
		},
		notify: (message) => {
			notified.push(message);
		},
		now: () => clock,
		schedule: (callback, delayMs) => {
			const timer: FakeScheduledTimer = { callback, delayMs, cleared: false };
			timers.push(timer);
			const handle: TimerHandle = {
				clear: () => {
					timer.cleared = true;
				},
			};
			handles.set(handle, timer);
			return handle;
		},
	};
	return {
		timers,
		appended,
		notified,
		host,
		pending: () => timers.filter((timer) => !timer.cleared).length,
		setClock: (nowMs) => {
			clock = nowMs;
		},
		fire: (timer) => {
			timer.cleared = true;
			timer.callback();
		},
	};
}

describe("createTimerRunner", () => {
	it("emits an occurrence as a declared fact and schedules the next (SPEC §12)", () => {
		const fake = fakeHost(0);
		const state: Record<string, TimerOccurrenceState> = {};
		const runner = createTimerRunner(fake.host, state);
		runner.start();
		// One pending handle per timer: hourly, daily, broken.
		expect(fake.pending()).toBe(3);

		const intervalTimer = fake.timers[0];
		expect(intervalTimer?.delayMs).toBe(HOUR_MS);
		fake.setClock(HOUR_MS);
		if (intervalTimer === undefined) {
			throw new Error("fixture broken: no interval timer");
		}
		fake.fire(intervalTimer);

		expect(fake.appended).toHaveLength(1);
		const event = fake.appended[0];
		expect(event?.source).toBe("timer");
		expect(event?.type).toBe("progress.review-became-due");
		const scheduledFor = new Date(HOUR_MS).toISOString();
		expect(event?.payload).toEqual({ scheduledFor });
		expect(event?.eventId).toBe(
			deriveEventId("default", "hourly", scheduledFor),
		);
		expect(state.hourly?.lastIntervalFiredAt).toBe(HOUR_MS);
		// Next interval scheduled from the fired occurrence, one interval ahead.
		expect(fake.timers.at(-1)?.delayMs).toBe(HOUR_MS);
		expect(fake.pending()).toBe(3);
	});

	it("catches up with at most the latest missed interval occurrence (AC-17)", () => {
		const fake = fakeHost(2.5 * HOUR_MS);
		const state: Record<string, TimerOccurrenceState> = {
			hourly: { lastIntervalFiredAt: 0 },
		};
		createTimerRunner(fake.host, state).start();
		expect(fake.appended).toHaveLength(1);
		const scheduledFor = new Date(2 * HOUR_MS).toISOString();
		expect(fake.appended[0]?.payload).toEqual({ scheduledFor });
		expect(state.hourly?.lastIntervalFiredAt).toBe(2 * HOUR_MS);
		// Ongoing schedule continues from the caught-up occurrence.
		expect(fake.pending()).toBe(3);
	});

	it("does not catch up without a recorded last-fired timestamp (SPEC §12)", () => {
		const fake = fakeHost(100 * HOUR_MS);
		const state: Record<string, TimerOccurrenceState> = {};
		createTimerRunner(fake.host, state).start();
		expect(fake.appended).toHaveLength(0);
		expect(state.hourly).toBeUndefined();
	});

	it("never emits a missed daily occurrence on resume (SPEC §12)", () => {
		// The daily slot passed hours ago while the session was closed.
		const slot = new Date(2026, 0, 5, 9, 30, 0, 0).getTime();
		const fake = fakeHost(slot + 5 * HOUR_MS);
		const state: Record<string, TimerOccurrenceState> = {
			daily: { lastDailyDate: "2026-01-04" },
		};
		createTimerRunner(fake.host, state).start();
		expect(fake.appended).toHaveLength(0);
	});

	it("suppresses duplicate occurrences via known event ids (SPEC §8)", () => {
		const occurrence = HOUR_MS;
		const knownEventId = deriveEventId(
			"default",
			"hourly",
			new Date(occurrence).toISOString(),
		);
		const fake = fakeHost(0, [knownEventId]);
		const state: Record<string, TimerOccurrenceState> = {};
		const runner = createTimerRunner(fake.host, state);
		runner.start();
		fake.setClock(occurrence);
		const intervalTimer = fake.timers[0];
		if (intervalTimer === undefined) {
			throw new Error("fixture broken: no interval timer");
		}
		fake.fire(intervalTimer);
		expect(fake.appended).toHaveLength(0);
		// The occurrence is still recorded so the next slot schedules normally.
		expect(state.hourly?.lastIntervalFiredAt).toBe(occurrence);
	});

	it("skips occurrences whose payload contract fails and notifies the operator", () => {
		const fake = fakeHost(0);
		const state: Record<string, TimerOccurrenceState> = {};
		const runner = createTimerRunner(fake.host, state);
		runner.start();
		const brokenTimer = fake.timers.find(
			(timer) => timer.delayMs === 30 * 60_000,
		);
		fake.setClock(30 * 60_000);
		if (brokenTimer === undefined) {
			throw new Error("fixture broken: no broken timer");
		}
		fake.fire(brokenTimer);
		expect(fake.appended).toHaveLength(0);
		expect(fake.notified).toHaveLength(1);
		expect(fake.notified[0]).toContain("broken");
		// Bookkeeping must not advance occurrence state when payload contract fails
		expect(state.broken).toBeUndefined();
	});

	it("does not advance occurrence state when appendEvent fails (SPEC §12)", () => {
		const fake = fakeHost(0, [], () => {
			throw new Error("disk full");
		});
		const state: Record<string, TimerOccurrenceState> = {};
		const runner = createTimerRunner(fake.host, state);
		runner.start();
		fake.setClock(HOUR_MS);
		const intervalTimer = fake.timers[0];
		if (intervalTimer === undefined) {
			throw new Error("fixture broken: no interval timer");
		}
		fake.fire(intervalTimer);
		expect(state.hourly).toBeUndefined();
	});

	it("stop clears pending handles: occurrences stop while the session is closed (SPEC §12)", () => {
		const fake = fakeHost(0);
		const state: Record<string, TimerOccurrenceState> = {};
		const runner = createTimerRunner(fake.host, state);
		runner.start();
		expect(fake.pending()).toBe(3);
		runner.stop();
		expect(fake.pending()).toBe(0);
		fake.setClock(10 * HOUR_MS);
		for (const timer of fake.timers) {
			timer.callback();
		}
		expect(fake.appended).toHaveLength(0);
	});

	it("restart invalidates the previous run's callbacks (reload/profile change)", () => {
		const fake = fakeHost(0);
		const state: Record<string, TimerOccurrenceState> = {};
		const runner = createTimerRunner(fake.host, state);
		runner.start();
		const staleTimer = fake.timers[0];
		runner.stop();
		runner.start();
		// The stale callback from the earlier run must neither emit nor reschedule.
		fake.setClock(HOUR_MS);
		staleTimer?.callback();
		expect(fake.appended).toHaveLength(0);
	});
});
