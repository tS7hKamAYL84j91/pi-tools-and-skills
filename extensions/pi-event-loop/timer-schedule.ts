/** Timer occurrence math and declared-fact construction (SPEC §8, §12). */

import { validateEventPayload } from "./event-ingress.js";
import type {
	EventLoopConfig,
	LoopEventData,
	ProfileConfig,
	TimerSpec,
} from "./types.js";
import { deriveEventId } from "./types.js";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Cancel handle for one scheduled occurrence. */
export interface TimerHandle {
	readonly clear: () => void;
}

/** Pi-facing dependencies of the timer source; injected for deterministic tests. */
export interface TimerHost {
	readonly profileName: string;
	readonly profile: ProfileConfig;
	readonly limits: EventLoopConfig["limits"];
	/** Deterministic IDs already accepted; hits suppress duplicate occurrences (SPEC §8). */
	readonly knownEventIds: () => ReadonlySet<string>;
	/** Append one timer fact and run the post-append pipeline (SPEC §12). */
	readonly appendEvent: (event: LoopEventData) => void;
	/** Operator-visible notice when a timer occurrence cannot be emitted. */
	readonly notify?: (message: string) => void;
	readonly now: () => number;
	readonly schedule: (callback: () => void, delayMs: number) => TimerHandle;
}

/** Build the declared fact for one timer occurrence (SPEC §8, §12). */
export function buildTimerEvent(
	host: Pick<TimerHost, "profileName" | "now" | "profile" | "limits">,
	spec: TimerSpec,
	scheduledForMs: number,
): LoopEventData | undefined {
	const eventSpec = host.profile.events[spec.emit];
	if (eventSpec === undefined) {
		return undefined;
	}
	const scheduledFor = new Date(scheduledForMs).toISOString();
	const event: LoopEventData = {
		// Timer identity: sha256(profile + timerId + scheduledFor) (SPEC §8).
		eventId: deriveEventId(host.profileName, spec.id, scheduledFor),
		type: spec.emit,
		occurredAt: new Date(host.now()).toISOString(),
		source: "timer",
		payload: { scheduledFor },
	};
	const payloadProblem = validateEventPayload(
		eventSpec.requiredPayload,
		event.payload,
		host.limits.maxPayloadBytes,
	);
	if (payloadProblem !== undefined) {
		return undefined;
	}
	return event;
}

/** Latest missed interval occurrence, or undefined when at most zero were missed. */
export function latestMissedIntervalOccurrenceMs(
	intervalMinutes: number,
	lastFiredAt: number | undefined,
	nowMs: number,
): number | undefined {
	if (lastFiredAt === undefined) {
		// First run: no catch-up, so the bound never depends on epoch arithmetic (SPEC §12).
		return undefined;
	}
	const intervalMs = intervalMinutes * MINUTE_MS;
	const missedSlots = Math.floor((nowMs - lastFiredAt) / intervalMs);
	if (missedSlots < 1) {
		return undefined;
	}
	return lastFiredAt + missedSlots * intervalMs;
}

/** Next interval occurrence strictly after now. */
export function nextIntervalOccurrenceMs(
	intervalMinutes: number,
	lastFiredAt: number | undefined,
	nowMs: number,
): number {
	const intervalMs = intervalMinutes * MINUTE_MS;
	if (lastFiredAt === undefined || nowMs <= lastFiredAt) {
		return nowMs + intervalMs;
	}
	// First slot strictly after now; catch-up never bursts (SPEC §12).
	const elapsedSlots = Math.floor((nowMs - lastFiredAt) / intervalMs) + 1;
	return lastFiredAt + elapsedSlots * intervalMs;
}

/** Local-timezone YYYY-MM-DD key for dailyAt occurrence bookkeeping. */
export function localDateKey(timestampMs: number): string {
	const date = new Date(timestampMs);
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

/** Next local-time occurrence of "HH:MM": today when still ahead, otherwise tomorrow. */
export function nextDailyOccurrenceMs(
	dailyAt: string,
	lastDailyDate: string | undefined,
	nowMs: number,
): number {
	const [hoursText, minutesText] = dailyAt.split(":");
	const hours = Number.parseInt(hoursText ?? "0", 10);
	const minutes = Number.parseInt(minutesText ?? "0", 10);
	const now = new Date(nowMs);
	let target = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
		hours,
		minutes,
		0,
		0,
	);
	const todayFired =
		lastDailyDate !== undefined &&
		localDateKey(target.getTime()) === lastDailyDate;
	if (target.getTime() <= nowMs || todayFired) {
		target = new Date(target.getTime() + DAY_MS);
	}
	return target.getTime();
}
