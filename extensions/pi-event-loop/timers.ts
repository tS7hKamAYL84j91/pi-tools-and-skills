/** Timer source: deterministic time facts through the normal append path (SPEC §12). */

import {
	buildTimerEvent,
	latestMissedIntervalOccurrenceMs,
	localDateKey,
	nextDailyOccurrenceMs,
	nextIntervalOccurrenceMs,
	type TimerHandle,
	type TimerHost,
} from "./timer-schedule.js";
import type { TimerOccurrenceState, TimerSpec } from "./types.js";

/** Node clamps setTimeout delays above ~2^31 to 1ms; cap below and reschedule on wake. */
const MAX_SCHEDULE_DELAY_MS = 2 ** 30;

export interface TimerRunner {
	/** Emit catch-up occurrences (≤1 per interval timer, none for daily) then schedule. */
	readonly start: () => void;
	/** Clear every pending handle: shutdown, reload and profile change (SPEC §12). */
	readonly stop: () => void;
}

/** Shared per-runner context: one validity epoch plus the live handle set. */
interface TimerContext {
	readonly host: TimerHost;
	readonly state: Record<string, TimerOccurrenceState>;
	readonly handles: Set<TimerHandle>;
	/** Monotonic run token; scheduled callbacks no-op unless it still matches. */
	run: number;
}

/** Fire-time facts captured when the handle was scheduled. */
interface TimerFire {
	readonly target: number;
	readonly handle: TimerHandle;
	readonly run: number;
}

function nextTimerTargetMs(
	context: TimerContext,
	spec: TimerSpec,
): number | undefined {
	if (spec.intervalMinutes !== undefined) {
		return nextIntervalOccurrenceMs(
			spec.intervalMinutes,
			context.state[spec.id]?.lastIntervalFiredAt,
			context.host.now(),
		);
	}
	if (spec.dailyAt !== undefined) {
		return nextDailyOccurrenceMs(
			spec.dailyAt,
			context.state[spec.id]?.lastDailyDate,
			context.host.now(),
		);
	}
	return undefined;
}

function clearHandles(context: TimerContext): void {
	context.run++;
	for (const handle of context.handles) {
		handle.clear();
	}
	context.handles.clear();
}

function emitTimerOccurrence(
	context: TimerContext,
	spec: TimerSpec,
	scheduledForMs: number,
): boolean {
	const event = buildTimerEvent(context.host, spec, scheduledForMs);
	if (event === undefined) {
		context.host.notify?.(
			`timer "${spec.id}" occurrence skipped: event "${spec.emit}" is undeclared or its payload contract failed`,
		);
		return false;
	}
	if (context.host.knownEventIds().has(event.eventId)) {
		return true;
	}
	try {
		context.host.appendEvent(event);
		return true;
	} catch (error) {
		context.host.notify?.(
			`timer "${spec.id}" append failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

function recordTimerOccurrence(
	context: TimerContext,
	spec: TimerSpec,
	scheduledForMs: number,
): void {
	const previous = context.state[spec.id];
	if (spec.intervalMinutes !== undefined) {
		context.state[spec.id] = {
			...previous,
			lastIntervalFiredAt: scheduledForMs,
		};
		return;
	}
	context.state[spec.id] = {
		...previous,
		lastDailyDate: localDateKey(scheduledForMs),
	};
}

function scheduleTimer(context: TimerContext, spec: TimerSpec): void {
	const run = context.run;
	const target = nextTimerTargetMs(context, spec);
	if (target === undefined) {
		return;
	}
	const delay = Math.min(
		Math.max(target - context.host.now(), 0),
		MAX_SCHEDULE_DELAY_MS,
	);
	const handle = context.host.schedule(() => {
		onTimerFired(context, spec, { target, handle, run });
	}, delay);
	context.handles.add(handle);
}

function onTimerFired(
	context: TimerContext,
	spec: TimerSpec,
	fire: TimerFire,
): void {
	const { target, handle, run } = fire;
	if (run !== context.run) {
		// A newer start/stop invalidated this run.
		return;
	}
	context.handles.delete(handle);
	if (context.host.now() < target) {
		// Woke early (delay cap); reschedule without emitting.
		scheduleTimer(context, spec);
		return;
	}
	const emitted = emitTimerOccurrence(context, spec, target);
	if (emitted) {
		recordTimerOccurrence(context, spec, target);
	}
	scheduleTimer(context, spec);
}

/** Interval timers emit at most the latest missed occurrence; daily timers none (SPEC §12). */
function catchUpTimer(context: TimerContext, spec: TimerSpec): void {
	if (spec.intervalMinutes === undefined) {
		return;
	}
	const occurrence = latestMissedIntervalOccurrenceMs(
		spec.intervalMinutes,
		context.state[spec.id]?.lastIntervalFiredAt,
		context.host.now(),
	);
	if (occurrence === undefined) {
		return;
	}
	const emitted = emitTimerOccurrence(context, spec, occurrence);
	if (emitted) {
		recordTimerOccurrence(context, spec, occurrence);
	}
}

/**
 * Timer occurrences are declared facts, never direct agent invocations: each occurrence
 * appends one deterministic event through the normal append-and-project path, from which
 * automations may issue commands. Handles are tracked per run; stop() invalidates them.
 */
export function createTimerRunner(
	host: TimerHost,
	state: Record<string, TimerOccurrenceState>,
): TimerRunner {
	const context: TimerContext = {
		host,
		state,
		handles: new Set<TimerHandle>(),
		run: 0,
	};
	return {
		start: () => {
			clearHandles(context);
			for (const spec of host.profile.timers) {
				catchUpTimer(context, spec);
				scheduleTimer(context, spec);
			}
		},
		stop: () => {
			clearHandles(context);
		},
	};
}
