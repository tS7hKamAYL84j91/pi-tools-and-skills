/** Tests for command delivery, settlement transitions and the settle probe (SPEC §5, §10, §11, §17). */

import { describe, expect, it } from "vitest";
import {
	CONFIG,
	PROFILE,
	workCompleted,
	workItem,
	workRequested,
} from "../../../tests/fixtures/pi-event-loop.js";
import { createPostAppendPipeline } from "../automator.js";
import { buildCommandRecord } from "../command-queue.js";
import {
	buildCommandMessage,
	commandEmittedOutcome,
	type DeliveryOptions,
	deliverNextCommand,
	settleActiveCommand,
	waitForSettled,
} from "../dispatcher.js";
import { createEventLoopRuntime } from "../runtime.js";
import type { LoopEventData } from "../types.js";

function runtimeWithQueuedCommand(): ReturnType<typeof createEventLoopRuntime> {
	const runtime = createEventLoopRuntime();
	createPostAppendPipeline(runtime)(
		workRequested("work-42"),
		CONFIG,
		"default",
	);
	return runtime;
}

describe("buildCommandMessage", () => {
	it("carries the self-describing contract as structured details (SPEC §10)", () => {
		const record = buildCommandRecord(
			"default",
			PROFILE,
			PROFILE.automations[0]!,
			workItem("outstanding"),
		);
		expect(record).toBeDefined();
		const message = buildCommandMessage(record!);
		expect(message.customType).toBe("pi-event-loop-command");
		expect(message.content).toContain("Perform the work.");
		expect(message.content).toContain(`commandId: ${record!.commandId}`);
		expect(message.content).toContain("commandType: perform-work");
		expect(message.content).toContain("workItemId: item-work-42");
		expect(message.content).toContain("correlationId: work-42");
		expect(message.content).toContain(
			"expected outcomes: work.completed, work.failed",
		);
		expect(message.content).toContain("workItem payload (untrusted data):");
		expect(message.display).toBe(true);
		expect(message.details).toEqual({
			commandId: record!.commandId,
			commandType: "perform-work",
			workItemId: "item-work-42",
			correlationId: "work-42",
			causedBy: "evt-open",
			workItem: { workId: "work-42" },
			expectedEvents: ["work.completed", "work.failed"],
		});
	});
});

describe("deliverNextCommand", () => {
	it("delivers the next queued command with triggering delivery options", async () => {
		const runtime = runtimeWithQueuedCommand();
		const sent: Array<{ message: unknown; options: DeliveryOptions }> = [];
		const outcome = await deliverNextCommand(
			{
				sendMessage: async (message, options) =>
					void sent.push({ message, options }),
			},
			runtime,
		);
		expect(outcome.delivered).toBe(true);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.options).toEqual({
			triggerTurn: true,
		});
		expect(runtime.activeCommand?.status).toBe("delivered");
		expect(runtime.activeWorkItem?.key).toBe("work-42");
		expect(runtime.consecutiveAutomatedTurns).toBe(1);
		const item = [...runtime.projection.items.values()][0];
		expect(item?.status).toBe("dispatched");
		expect(item?.commandId).toBe(runtime.activeCommand?.commandId);
		expect(runtime.queue).toHaveLength(0);
	});

	it("refuses delivery while paused", async () => {
		const runtime = runtimeWithQueuedCommand();
		runtime.paused = true;
		runtime.pauseReason = "missing-outcome: test";
		const outcome = await deliverNextCommand(
			{ sendMessage: () => undefined },
			runtime,
		);
		expect(outcome.delivered).toBe(false);
		expect(outcome.reason).toContain("missing-outcome");
		expect(runtime.activeCommand).toBeUndefined();
	});

	it("refuses delivery when a command is already active (one active command, SPEC §11)", async () => {
		const runtime = runtimeWithQueuedCommand();
		await deliverNextCommand({ sendMessage: () => undefined }, runtime);
		runtime.queue = [...runtime.queue]; // unchanged
		const second = await deliverNextCommand(
			{ sendMessage: () => undefined },
			runtime,
		);
		expect(second.delivered).toBe(false);
		expect(second.reason).toContain("already active");
	});

	it("refuses delivery when the queue is empty", async () => {
		const runtime = createEventLoopRuntime();
		const outcome = await deliverNextCommand(
			{ sendMessage: () => undefined },
			runtime,
		);
		expect(outcome.delivered).toBe(false);
		expect(outcome.reason).toContain("no queued commands");
	});
});

describe("settleActiveCommand", () => {
	it("with an expected outcome event: settles cleanly only when item is completed", () => {
		const runtime = runtimeWithQueuedCommand();
		deliverNextCommand({ sendMessage: () => undefined }, runtime);
		// Mark item completed in projection as an accepted closing event would do
		const workItemId = runtime.activeCommand!.workItemId;
		const item = runtime.projection.items.get(workItemId)!;
		runtime.projection = {
			...runtime.projection,
			items: new Map([
				...runtime.projection.items,
				[workItemId, { ...item, status: "completed" }],
			]),
		};
		const outcome = settleActiveCommand(runtime, true);
		expect(outcome).toEqual({ settled: true, stalled: false });
		expect(runtime.activeCommand).toBeUndefined();
		expect(runtime.activeWorkItem).toBeUndefined();
		expect(runtime.paused).toBe(false);
	});

	it("with an expected event that did not complete the item: stalls and pauses (AC-14, AC-15)", () => {
		const runtime = runtimeWithQueuedCommand();
		deliverNextCommand({ sendMessage: () => undefined }, runtime);
		// Work item is still dispatched, not completed
		const outcome = settleActiveCommand(runtime, true);
		expect(outcome).toEqual({ settled: true, stalled: true });
		expect(runtime.paused).toBe(true);
		expect(runtime.pauseReason).toContain("missing-outcome");
	});

	it("without an expected outcome event: stalls the item and pauses delivery (SPEC §11)", () => {
		const runtime = runtimeWithQueuedCommand();
		deliverNextCommand({ sendMessage: () => undefined }, runtime);
		const commandId = runtime.activeCommand?.commandId;
		const outcome = settleActiveCommand(runtime, false);
		expect(outcome).toEqual({ settled: true, stalled: true });
		const item = [...runtime.projection.items.values()][0];
		expect(item?.status).toBe("stalled");
		expect(runtime.paused).toBe(true);
		expect(runtime.pauseReason).toContain("missing-outcome");
		expect(runtime.pauseReason).toContain(commandId);
		expect(runtime.activeCommand).toBeUndefined();
	});

	it("is a no-op without an active command", () => {
		const runtime = createEventLoopRuntime();
		expect(settleActiveCommand(runtime, true)).toEqual({
			settled: false,
			stalled: false,
		});
	});
});

describe("waitForSettled", () => {
	it("returns immediately when the probe reports idle with no pending messages", async () => {
		const settled = await waitForSettled(
			{ isIdle: () => true, hasPendingMessages: () => false },
			50,
			5,
		);
		expect(settled).toBe(true);
	});

	it("keeps waiting while a turn is streaming or messages are queued", async () => {
		let polls = 0;
		const settled = await waitForSettled(
			{
				isIdle: () => {
					polls++;
					return polls >= 3;
				},
				hasPendingMessages: () => false,
			},
			1000,
			5,
		);
		expect(settled).toBe(true);
		expect(polls).toBeGreaterThanOrEqual(3);
	});

	it("returns false on timeout instead of waiting forever", async () => {
		const settled = await waitForSettled(
			{ isIdle: () => false, hasPendingMessages: () => false },
			30,
			5,
		);
		expect(settled).toBe(false);
	});
});

describe("close events do not create commands", () => {
	it("a completed item is skipped by later scans", () => {
		const runtime = createEventLoopRuntime();
		const pipeline = createPostAppendPipeline(runtime);
		pipeline(workRequested("work-42"), CONFIG, "default");
		pipeline(workCompleted("work-42"), CONFIG, "default");
		expect(runtime.queue.every((record) => record.status === "cancelled")).toBe(
			true,
		);
	});
});

describe("commandEmittedOutcome", () => {
	const command = {
		commandId: "cmd-1",
		expectedEvents: ["work.completed", "work.failed"],
	} as never;

	function outcomeEvent(overrides: Partial<LoopEventData>): LoopEventData {
		return {
			eventId: "evt-outcome",
			type: "work.completed",
			occurredAt: "2026-01-01T00:00:00.000Z",
			source: "agent",
			payload: { workId: "work-1" },
			...overrides,
		};
	}

	it("detects an accepted expected event with the command's causation", () => {
		expect(
			commandEmittedOutcome([outcomeEvent({ commandId: "cmd-1" })], command),
		).toBe(true);
	});

	it("ignores events of other commands or unexpected types", () => {
		const other = outcomeEvent({ commandId: "cmd-2" });
		const unexpected = outcomeEvent({ type: "progress.note" });
		expect(commandEmittedOutcome([other], command)).toBe(false);
		expect(commandEmittedOutcome([unexpected], command)).toBe(false);
		expect(commandEmittedOutcome([], command)).toBe(false);
	});
});
