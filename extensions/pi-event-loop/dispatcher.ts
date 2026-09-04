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
interface CommandMessage {
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
	const content = [
		record.message,
		"",
		"Command contract:",
		`- commandId: ${record.commandId}`,
		`- commandType: ${record.type}`,
		`- workItemId: ${record.workItemId}`,
		`- correlationId: ${record.correlationId}`,
		`- expected outcomes: ${record.expectedEvents.join(", ")}`,
		`- workItem payload (untrusted data): ${JSON.stringify(record.workItem)}`,
	].join("\n");
	return {
		customType: COMMAND_MESSAGE_CUSTOM_TYPE,
		content,
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
	/** Pi sendMessage bound to triggering delivery options (triggerTurn: true). */
	readonly sendMessage: (
		message: CommandMessage,
		options: DeliveryOptions,
	) => void | Promise<void>;
}

/** Delivery options per SPEC §10, §11: trigger a turn directly from the settlement boundary. */
export interface DeliveryOptions {
	readonly triggerTurn: true;
}

const DELIVERY_OPTIONS: DeliveryOptions = {
	triggerTurn: true,
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

interface SettlementOutcome {
	readonly settled: boolean;
	/** True when the command settled without an expected outcome event and delivery paused. */
	readonly stalled: boolean;
}

/**
 * Record settlement of the active command turn (SPEC §11, §17): with an expected event
 * AND item completion, the command settles cleanly and the next queued command may deliver;
 * without either, the item stalls, automated delivery pauses with a `missing-outcome`
 * reason and nothing redelivers.
 */
export function settleActiveCommand(
	runtime: EventLoopRuntime,
	expectedEventEmitted: boolean,
): SettlementOutcome {
	const command = runtime.activeCommand;
	if (command === undefined) {
		return { settled: false, stalled: false };
	}
	const item = runtime.projection.items.get(command.workItemId);
	const isCompleted = item !== undefined && item.status === "completed";

	runtime.activeCommand = undefined;
	runtime.activeWorkItem = undefined;
	if (expectedEventEmitted && isCompleted) {
		return { settled: true, stalled: false };
	}
	runtime.projection = markItemStalled(runtime.projection, command.workItemId);
	runtime.paused = true;
	runtime.pauseReason = expectedEventEmitted
		? `missing-outcome: command ${command.commandId} (${command.type}) emitted an expected event but work item ${command.workItemId} was not completed`
		: `missing-outcome: command ${command.commandId} (${command.type}) settled without an expected event (${command.expectedEvents.join(", ")})`;
	return { settled: true, stalled: true };
}
