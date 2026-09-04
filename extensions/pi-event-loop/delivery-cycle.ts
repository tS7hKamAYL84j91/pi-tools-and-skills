/** Delivery cycle: sequential command delivery and settle-poll gating (SPEC §5, §11, §17). */

import {
	type CommandMessage,
	commandEmittedOutcome,
	type DeliveryOptions,
	defaultSleep,
	deliverNextCommand,
	type SettleProbe,
	settleActiveCommand,
	waitForSettled,
} from "./dispatcher.js";
import type { EventLoopRuntime } from "./runtime.js";
import type { CommandRecord, LimitsConfig, LoopEventData } from "./types.js";

/** Wait until a turn has started: the probe is no longer idle, or messages are queued. */
async function waitForTurnStart(
	probe: SettleProbe,
	sleep: (ms: number) => Promise<void>,
	pollMs: number,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!probe.isIdle() || probe.hasPendingMessages()) {
			return true;
		}
		await sleep(pollMs);
	}
	return false;
}

interface DeliveryCycleDeps {
	readonly runtime: EventLoopRuntime;
	readonly probe: SettleProbe;
	readonly sendMessage: (
		message: CommandMessage,
		options: DeliveryOptions,
	) => void | Promise<void>;
	/** Session event log access for outcome detection (SPEC §11). */
	readonly readEvents: () => readonly LoopEventData[];
	/** Persist a checkpoint before each delivery (SPEC §11). */
	readonly persist: () => void;
	readonly limits: LimitsConfig;
	/** Injected sleep for deterministic tests. */
	readonly sleep?: (ms: number) => Promise<void>;
	readonly pollMs?: number;
	readonly turnStartTimeoutMs?: number;
	readonly settleTimeoutMs?: number;
	/** Escape hatch so a stale cycle exits after shutdown/reload (SPEC §17). */
	readonly isActive?: () => boolean;
}

export interface DeliveryCycleResult {
	readonly delivered: number;
	readonly settled: number;
	readonly stalled: boolean;
	/** Operator-visible reason when the cycle stopped before draining the queue. */
	readonly stoppedReason?: string;
}

/** Mutable accumulator built up while the cycle runs. */
interface DeliveryCycleAccumulator {
	delivered: number;
	settled: number;
	stalled: boolean;
	stoppedReason?: string;
}

interface CycleTimings {
	readonly sleep: (ms: number) => Promise<void>;
	readonly pollMs: number;
	readonly turnStartTimeoutMs: number;
	readonly settleTimeoutMs: number;
}

const DEFAULT_TURN_START_TIMEOUT_MS = 30_000;
/** Turn settlement may legitimately take far longer than the pi-boost 30s probe. */
const DEFAULT_SETTLE_TIMEOUT_MS = 3_600_000;

/**
 * Deliver queued commands and settle each in sequence (SPEC §5, §11, §17). One command
 * is active at a time; the next delivers only after the previous turn settled. A turn
 * that settles without an expected outcome event stalls its item and pauses delivery.
 * The settlement boundary is the idle/pending polling probe — never agent_end.
 */
export async function runDeliveryCycle(
	deps: DeliveryCycleDeps,
): Promise<DeliveryCycleResult> {
	const accumulated = await runDeliveryCycleSteps(deps);
	return {
		delivered: accumulated.delivered,
		settled: accumulated.settled,
		stalled: accumulated.stalled,
		stoppedReason: accumulated.stoppedReason,
	};
}

async function runDeliveryCycleSteps(
	deps: DeliveryCycleDeps,
): Promise<DeliveryCycleAccumulator> {
	const timings: CycleTimings = {
		sleep: deps.sleep ?? defaultSleep,
		pollMs: deps.pollMs ?? 100,
		turnStartTimeoutMs:
			deps.turnStartTimeoutMs ?? DEFAULT_TURN_START_TIMEOUT_MS,
		settleTimeoutMs: deps.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS,
	};
	const result: DeliveryCycleAccumulator = {
		delivered: 0,
		settled: 0,
		stalled: false,
	};
	for (;;) {
		if (deps.isActive?.() === false) {
			result.stoppedReason = "the session is no longer open";
			return result;
		}
		if (deps.runtime.paused) {
			result.stoppedReason = deps.runtime.pauseReason;
			return result;
		}
		const active = deps.runtime.activeCommand;
		if (active !== undefined) {
			const settled = await settleDeliveredCommand(
				deps,
				active,
				timings,
				result,
			);
			if (settled === "stop") {
				return result;
			}
			continue;
		}
		const delivered = await deliverWithinLimits(deps, result);
		if (delivered === "stop") {
			return result;
		}
	}
}

/** Wait for the delivered turn to start and settle, then record the transition (SPEC §11). */
async function settleDeliveredCommand(
	deps: DeliveryCycleDeps,
	active: CommandRecord,
	timings: CycleTimings,
	result: DeliveryCycleAccumulator,
): Promise<"continue" | "stop"> {
	await waitForTurnStart(
		deps.probe,
		timings.sleep,
		timings.pollMs,
		timings.turnStartTimeoutMs,
	);
	if (deps.isActive?.() === false) {
		result.stoppedReason = "the session is no longer open";
		return "stop";
	}
	const settledInTime = await waitForSettled(
		deps.probe,
		timings.settleTimeoutMs,
		timings.pollMs,
		timings.sleep,
	);
	if (!settledInTime) {
		// Leave the command active: the next pipeline event re-enters the cycle.
		result.stoppedReason = `settle-timeout: command ${active.commandId} did not settle within ${timings.settleTimeoutMs}ms`;
		return "stop";
	}
	const expectedEmitted = commandEmittedOutcome(deps.readEvents(), active);
	const settlement = settleActiveCommand(deps.runtime, expectedEmitted);
	result.settled++;
	if (settlement.stalled) {
		result.stalled = true;
		result.stoppedReason = deps.runtime.pauseReason;
		return "stop";
	}
	return "continue";
}

/** Persist and deliver the next queued command unless a limit or empty queue stops it (SPEC §11, §14). */
async function deliverWithinLimits(
	deps: DeliveryCycleDeps,
	result: DeliveryCycleAccumulator,
): Promise<"continue" | "stop"> {
	const { runtime } = deps;
	const hasQueued = runtime.queue.some((record) => record.status === "queued");
	if (!hasQueued) {
		return "stop";
	}
	if (runtime.consecutiveAutomatedTurns >= deps.limits.maxConsecutiveTurns) {
		// Loop protection: consecutive automated turns hit the ceiling (SPEC §14).
		runtime.paused = true;
		runtime.pauseReason = `turn-limit: ${runtime.consecutiveAutomatedTurns} consecutive automated turns reached maxConsecutiveTurns ${deps.limits.maxConsecutiveTurns}; interactive user input resets the counter`;
		result.stoppedReason = runtime.pauseReason;
		return "stop";
	}
	// Persist before delivery (SPEC §11).
	deps.persist();
	const outcome = await deliverNextCommand(deps, runtime);
	if (!outcome.delivered) {
		result.stoppedReason = outcome.reason;
		return "stop";
	}
	result.delivered++;
	return "continue";
}
