/** Cross-module integration tests for the pi-event-loop extension (SPEC §5 runtime cycle). */

import { describe, expect, it } from "vitest";

import { createPostAppendPipeline } from "../extensions/pi-event-loop/automator.js";
import { parseEventLoopConfig } from "../extensions/pi-event-loop/config.js";
import { deliverNextCommand, settleActiveCommand } from "../extensions/pi-event-loop/dispatcher.js";
import { readEventLog } from "../extensions/pi-event-loop/event-log.js";
import { evaluateEmission, type EmissionContext } from "../extensions/pi-event-loop/event-ingress.js";
import { createEventLoopRuntime } from "../extensions/pi-event-loop/runtime.js";
import { COMMAND_MESSAGE_CUSTOM_TYPE, EVENT_LOOP_EVENT_CUSTOM_TYPE } from "../extensions/pi-event-loop/types.js";
import { CONFIG, workCompleted, workRequested } from "./fixtures/pi-event-loop.js";

/** Full runtime cycle: request → queue → deliver → outcome → complete (SPEC §5). */
describe("pi-event-loop runtime cycle", () => {
	it("runs request → queue → deliver → outcome → completed without domain branching", async () => {
		const runtime = createEventLoopRuntime();
		const pipeline = createPostAppendPipeline(runtime);

		// 1. An operator/system fact opens work; the automator queues its command.
		pipeline(workRequested("work-1"), CONFIG, "default");
		expect(runtime.queue).toHaveLength(1);

		// 2. Delivery marks the item dispatched and produces the self-describing message.
		const sent: Array<{ customType: string; details: { expectedEvents: readonly string[] } }> = [];
		const outcome = await deliverNextCommand(
			{ sendMessage: async (message) => void sent.push(message) },
			runtime,
		);
		expect(outcome.delivered).toBe(true);
		const message = sent[0];
		expect(message?.customType).toBe(COMMAND_MESSAGE_CUSTOM_TYPE);
		expect(message?.details.expectedEvents).toEqual(["work.completed", "work.failed"]);
		const itemId = [...runtime.projection.order][0];
		const item = itemId !== undefined ? runtime.projection.items.get(itemId) : undefined;
		expect(item?.status).toBe("dispatched");

		// 3. The agent emits the expected outcome; the projection completes the item.
		pipeline(workCompleted("work-1"), CONFIG, "default");
		const completedItem = itemId !== undefined ? runtime.projection.items.get(itemId) : undefined;
		expect(completedItem?.status).toBe("completed");
		expect(completedItem?.completedByEventId).toBe(workCompleted("work-1").eventId);

		// 4. Settlement clears the active command; nothing is left queued or paused.
		const settled = settleActiveCommand(runtime, true);
		expect(settled).toEqual({ settled: true, stalled: false });
		expect(runtime.queue).toHaveLength(0);
		expect(runtime.paused).toBe(false);
	});

	it("stalls and pauses when the command turn settles without an expected outcome", async () => {
		const runtime = createEventLoopRuntime();
		createPostAppendPipeline(runtime)(workRequested("work-1"), CONFIG, "default");
		await deliverNextCommand({ sendMessage: async () => undefined }, runtime);
		const outcome = settleActiveCommand(runtime, false);
		expect(outcome.stalled).toBe(true);
		expect(runtime.paused).toBe(true);
		expect(runtime.pauseReason).toContain("missing-outcome");
	});

	it("event log round-trips through session entries and deduplicates by stable event id", () => {
		const context = emissionContext();
		const decision = evaluateEmission(context, {
			event: "work.completed",
			dedupeKey: "work-1",
			payload: { workId: "work-1", resultPath: "out/x.md" },
		});
		expect(decision.ok).toBe(true);
		if (!decision.ok) return;

		const entries: readonly { type: string; customType: string; data: unknown }[] = [
			{ type: "custom", customType: EVENT_LOOP_EVENT_CUSTOM_TYPE, data: decision.event },
		];
		const reread = readEventLog(entries);
		expect(reread).toHaveLength(1);
		expect(reread[0]?.eventId).toBe(decision.event.eventId);

		// A second emission with the same dedupe key is a duplicate with no second projection.
		const replay = evaluateEmission(emissionContext([decision.event.eventId]), {
			event: "work.completed",
			dedupeKey: "work-1",
			payload: { workId: "work-1", resultPath: "out/x.md" },
		});
		expect(replay.ok).toBe(true);
		if (!replay.ok) return;
		expect(replay.duplicate).toBe(true);
	});

	it("rejects configuration with unknown top-level fields (SPEC §18)", () => {
		const text = JSON.stringify({
			version: 1,
			activeProfile: "default",
			profiles: CONFIG.profiles,
			unknownTopLevel: true,
		});
		const result = parseEventLoopConfig(text);
		expect(result.ok).toBe(false);
		expect(result.errors.join("; ")).toContain("unknown");
	});
});

function emissionContext(knownEventIds: readonly string[] = []): EmissionContext {
	return {
		config: CONFIG,
		profileName: "default",
		source: "operator",
		activeCommand: undefined,
		activeWorkItem: undefined,
		knownEventIds: new Set(knownEventIds),
		now: () => "2026-01-01T00:00:00.000Z",
	};
}

// EVENT_LOOP_EVENT_CUSTOM_TYPE is consumed above via the entry literal; keep the import used.
void COMMAND_MESSAGE_CUSTOM_TYPE === COMMAND_MESSAGE_CUSTOM_TYPE;