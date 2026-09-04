/** Tests for the delivery cycle: sequential delivery, settle gating, stalls (SPEC §5, §11). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CONFIG,
	workRequested,
} from "../../../tests/fixtures/pi-event-loop.js";
import { createPostAppendPipeline } from "../automator.js";
import {
	type DeliveryCycleResult,
	runDeliveryCycle,
} from "../delivery-cycle.js";
import { createEventLoopRuntime, type EventLoopRuntime } from "../runtime.js";
import type { LimitsConfig, LoopEventData } from "../types.js";

const BASE_TIME = new Date("2026-01-05T10:00:00.000Z").getTime();

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(BASE_TIME);
});

afterEach(() => {
	vi.useRealTimers();
});

/** A runtime whose pipeline has queued one command per requested work item. */
function queuedRuntime(count: number): EventLoopRuntime {
	const runtime = createEventLoopRuntime();
	const pipeline = createPostAppendPipeline(runtime);
	for (let index = 0; index < count; index++) {
		pipeline(workRequested(`work-${index}`), CONFIG, "default");
	}
	return runtime;
}

/** Build an expected outcome event from a delivered command message. */
function outcomeFor(message: unknown): LoopEventData {
	const details = (
		message as {
			details: {
				commandId: string;
				workItemId: string;
				correlationId: string;
				expectedEvents: readonly string[];
			};
		}
	).details;
	return {
		eventId: `evt-outcome-${details.commandId}`,
		type: details.expectedEvents[0] ?? "work.completed",
		occurredAt: new Date(BASE_TIME).toISOString(),
		source: "agent",
		payload: { workId: details.correlationId },
		commandId: details.commandId,
		workItemId: details.workItemId,
		correlationId: details.correlationId,
		causationId: details.commandId,
	};
}

interface CycleHarness {
	readonly runtime: EventLoopRuntime;
	readonly sent: unknown[];
	readonly events: LoopEventData[];
	readonly persistCalls: { value: number };
	readonly cycle: Promise<DeliveryCycleResult>;
	idle: boolean;
}

function startCycle(options: {
	runtime: EventLoopRuntime;
	events?: LoopEventData[];
	limits?: LimitsConfig;
	turnStartTimeoutMs?: number;
	settleTimeoutMs?: number;
	isActive?: () => boolean;
	/** When false, sendMessage does not start a turn (pathological delivery). */
	startTurn?: boolean;
}): CycleHarness {
	const sent: unknown[] = [];
	const events = options.events ?? [];
	const persistCalls = { value: 0 };
	let idle = true;
	const cycle = runDeliveryCycle({
		runtime: options.runtime,
		probe: {
			isIdle: () => idle,
			hasPendingMessages: () => false,
		},
		sendMessage: (message) => {
			sent.push(message);
			if (options.startTurn !== false) {
				idle = false;
			}
		},
		readEvents: () => events,
		persist: () => {
			persistCalls.value++;
		},
		limits: options.limits ?? CONFIG.limits,
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		pollMs: 5,
		turnStartTimeoutMs: options.turnStartTimeoutMs ?? 1_000,
		settleTimeoutMs: options.settleTimeoutMs ?? 10_000,
		isActive: options.isActive,
	});
	return {
		runtime: options.runtime,
		sent,
		events,
		persistCalls,
		cycle,
		get idle() {
			return idle;
		},
		set idle(value: boolean) {
			idle = value;
		},
	};
}

describe("runDeliveryCycle", () => {
	it("delivers queued commands sequentially with one active command (SPEC §11, AC-13)", async () => {
		const harness = startCycle({ runtime: queuedRuntime(2) });
		await vi.advanceTimersByTimeAsync(10);
		expect(harness.sent).toHaveLength(1);
		expect(harness.persistCalls.value).toBe(1);

		// The command turn ends with an expected outcome event.
		harness.events.push(outcomeFor(harness.sent[0]));
		harness.idle = true;
		await vi.advanceTimersByTimeAsync(10);
		expect(harness.sent).toHaveLength(2);

		harness.events.push(outcomeFor(harness.sent[1]));
		harness.idle = true;
		await vi.advanceTimersByTimeAsync(10);
		const result = await harness.cycle;
		expect(result).toEqual({ delivered: 2, settled: 2, stalled: false });
		expect(harness.persistCalls.value).toBe(2);
	});

	it("stalls the item and pauses on settlement without an expected outcome (SPEC §11, AC-14)", async () => {
		const harness = startCycle({ runtime: queuedRuntime(2) });
		await vi.advanceTimersByTimeAsync(10);
		// The turn settles but no expected event was emitted.
		harness.idle = true;
		await vi.advanceTimersByTimeAsync(10);
		const result = await harness.cycle;
		expect(result.delivered).toBe(1);
		expect(result.settled).toBe(1);
		expect(result.stalled).toBe(true);
		expect(result.stoppedReason).toContain("missing-outcome");
		expect(harness.runtime.paused).toBe(true);
		const item = [...harness.runtime.projection.items.values()][0];
		expect(item?.status).toBe("stalled");
		// No spin: the second command was never delivered.
		expect(harness.sent).toHaveLength(1);
	});

	it("does not settle the command while the delivered turn is still running", async () => {
		const harness = startCycle({ runtime: queuedRuntime(1) });
		await vi.advanceTimersByTimeAsync(10);
		expect(harness.runtime.activeCommand).toBeDefined();
		// The turn is running (idle=false); settlement must wait for it to end.
		await vi.advanceTimersByTimeAsync(100);
		expect(harness.runtime.activeCommand).toBeDefined();
		expect(harness.sent).toHaveLength(1);
	});

	it("pauses at maxConsecutiveTurns before delivering the next command (SPEC §14, AC-21)", async () => {
		const limits: LimitsConfig = { ...CONFIG.limits, maxConsecutiveTurns: 1 };
		const harness = startCycle({ runtime: queuedRuntime(2), limits });
		await vi.advanceTimersByTimeAsync(10);
		harness.events.push(outcomeFor(harness.sent[0]));
		harness.idle = true;
		await vi.advanceTimersByTimeAsync(10);
		const result = await harness.cycle;
		expect(result.delivered).toBe(1);
		expect(result.settled).toBe(1);
		expect(harness.runtime.paused).toBe(true);
		expect(harness.runtime.pauseReason).toContain("turn-limit");
		expect(harness.sent).toHaveLength(1);
	});

	it("stops immediately while delivery is paused", async () => {
		const runtime = queuedRuntime(1);
		runtime.paused = true;
		runtime.pauseReason = "missing-outcome: test";
		const harness = startCycle({ runtime });
		const result = await harness.cycle;
		expect(result).toEqual({
			delivered: 0,
			settled: 0,
			stalled: false,
			stoppedReason: "missing-outcome: test",
		});
	});

	it("exits when the session is no longer active (shutdown/reload escape)", async () => {
		const harness = startCycle({
			runtime: queuedRuntime(1),
			isActive: () => false,
		});
		const result = await harness.cycle;
		expect(result.stoppedReason).toContain("no longer open");
		expect(harness.sent).toHaveLength(0);
	});

	it("leaves the command active on settle timeout instead of stalling blindly", async () => {
		const harness = startCycle({
			runtime: queuedRuntime(1),
			settleTimeoutMs: 50,
		});
		await vi.advanceTimersByTimeAsync(10);
		// The turn never settles within the window.
		await vi.advanceTimersByTimeAsync(100);
		const result = await harness.cycle;
		expect(result.stoppedReason).toContain("settle-timeout");
		expect(harness.runtime.activeCommand).toBeDefined();
		expect(harness.runtime.paused).toBe(false);
	});

	it("stalls honestly when a delivered turn never starts", async () => {
		const harness = startCycle({
			runtime: queuedRuntime(1),
			turnStartTimeoutMs: 20,
			startTurn: false,
		});
		// The probe never reports a started turn; after the turn-start timeout the
		// settle probe reports idle with no outcome → missing-outcome stall.
		await vi.advanceTimersByTimeAsync(50);
		const result = await harness.cycle;
		expect(result.stalled).toBe(true);
		expect(harness.runtime.paused).toBe(true);
		expect(harness.runtime.pauseReason).toContain("missing-outcome");
	});
});
