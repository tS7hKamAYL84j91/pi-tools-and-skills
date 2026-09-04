/** Command delivery as self-describing Pi messages and settlement transitions (SPEC §5, §10, §11). */

import { takeNextCommand } from "./command-queue.js";
import type { EventLoopRuntime } from "./runtime.js";
import { markItemDispatched, markItemStalled } from "./todo-view.js";
import {
	COMMAND_MESSAGE_CUSTOM_TYPE,
	type CommandRecord,
	type LoopEventData,
} from "./types.js";

/** Structured command message delivered to the agent (SPEC §10). */
export interface CommandMessage {
	readonly customType: string;
	readonly content: string;
	readonly display: true;
	readonly details: {
		readonly commandId: string;
		readonly commandType: string;
		readonly workItemId: string;
		readonly correlationId: string;
		readonly causedBy: string;
		readonly workItem: Readonly<Record<string, unknown>>;
		readonly expectedEvents: readonly string[];
	};
}

/** Build the self-describing message for one command. */
export function buildCommandMessage(record: CommandRecord): CommandMessage {
	return {
		customType: COMMAND_MESSAGE_CUSTOM_TYPE,
		content: record.message,
		display: true,
		details: {
			commandId: record.commandId,
			commandType: record.type,
			workItemId: record.workItemId,
			correlationId: record.correlationId,
			causedBy: record.causedBy,
			workItem: record.workItem,
			expectedEvents: record.expectedEvents,
		},
	};
}

/**
 * True when the command's turn already emitted one of its expected outcome events
 * (SPEC §11): an accepted event with the command's causal metadata in the log.
 */
export function commandEmittedOutcome(
	events: readonly LoopEventData[],
	command: CommandRecord,
): boolean {
	return events.some(
		(event) =>
			event.commandId === command.commandId &&
			command.expectedEvents.includes(event.type),
	);
}

interface DeliveryDeps {
	/** Pi sendMessage bound to the delivery options (triggerTurn: true, deliverAs: "nextTurn"). */
	readonly sendMessage: (
		message: CommandMessage,
		options: DeliveryOptions,
	) => void | Promise<void>;
}

/** Delivery options per SPEC §10: start a turn when idle, queue for the next turn otherwise. */
export interface DeliveryOptions {
	readonly triggerTurn: true;
	readonly deliverAs: "nextTurn";
}

const DELIVERY_OPTIONS: DeliveryOptions = {
	triggerTurn: true,
	deliverAs: "nextTurn",
};

interface DeliveryOutcome {
	readonly delivered: boolean;
	readonly commandId?: string;
	readonly reason?: string;
}

/**
 * Deliver the next queued command, if any (SPEC §5, §11). Delivery marks the work item
 * dispatched, records the single active command, and never interrupts a running turn:
 * `deliverAs: "nextTurn"` queues the message for the next turn when one is active.
 */
export async function deliverNextCommand(
	deps: DeliveryDeps,
	runtime: EventLoopRuntime,
): Promise<DeliveryOutcome> {
	if (runtime.paused) {
		return {
			delivered: false,
			reason: `automated delivery is paused: ${runtime.pauseReason ?? "unknown reason"}`,
		};
	}
	const taken = takeNextCommand(runtime.queue, runtime.activeCommand);
	if (taken === undefined) {
		return {
			delivered: false,
			reason:
				runtime.activeCommand !== undefined
					? "a command is already active"
					: "no queued commands",
		};
	}
	runtime.queue = taken.queue;
	runtime.activeCommand = { ...taken.command, status: "delivered" };
	const item = runtime.projection.items.get(taken.command.workItemId);
	runtime.activeWorkItem = item;
	runtime.projection = markItemDispatched(
		runtime.projection,
		taken.command.workItemId,
		taken.command.commandId,
	);
	runtime.consecutiveAutomatedTurns++;
	await deps.sendMessage(buildCommandMessage(taken.command), {
		...DELIVERY_OPTIONS,
	});
	return { delivered: true, commandId: taken.command.commandId };
}

/** Probe of Pi session idleness used for settlement detection (SPEC §17). */
export interface SettleProbe {
	readonly isIdle: () => boolean;
	readonly hasPendingMessages: () => boolean;
}

const SETTLE_POLL_MS = 100;
const SETTLE_TIMEOUT_MS = 30_000;

/** Shared settle-poll sleep; injectable via the cycle deps for deterministic tests. */
export async function defaultSleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until the agent has fully settled (no streaming, no queued messages).
 * The pinned pi extension API (0.74) exposes no `agent_settled` event, so settlement
 * is detected with the same idle/pending polling pattern pi-boost uses; swap to the
 * `agent_settled` hook when the API provides it (SPEC §17).
 */
export async function waitForSettled(
	probe: SettleProbe,
	timeoutMs: number = SETTLE_TIMEOUT_MS,
	pollMs: number = SETTLE_POLL_MS,
	sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (probe.isIdle() && !probe.hasPendingMessages()) {
			return true;
		}
		await sleep(pollMs);
	}
	return false;
}

interface SettlementOutcome {
	readonly settled: boolean;
	/** True when the command settled without an expected outcome event and delivery paused. */
	readonly stalled: boolean;
}

/**
 * Record settlement of the active command turn (SPEC §11, §17): with an expected event,
 * the command settles and the next queued command may deliver; without one, the item
 * stalls, automated delivery pauses with a `missing-outcome` reason and nothing redelivers.
 */
export function settleActiveCommand(
	runtime: EventLoopRuntime,
	expectedEventEmitted: boolean,
): SettlementOutcome {
	const command = runtime.activeCommand;
	if (command === undefined) {
		return { settled: false, stalled: false };
	}
	runtime.activeCommand = undefined;
	runtime.activeWorkItem = undefined;
	if (expectedEventEmitted) {
		return { settled: true, stalled: false };
	}
	runtime.projection = markItemStalled(runtime.projection, command.workItemId);
	runtime.paused = true;
	runtime.pauseReason = `missing-outcome: command ${command.commandId} (${command.type}) settled without an expected event (${command.expectedEvents.join(", ")})`;
	return { settled: true, stalled: true };
}
