/** Cross-module integration tests for the pi-event-loop extension (SPEC §5, §13, §15 runtime cycle). */

import { describe, expect, it } from "vitest";

import { createPostAppendPipeline } from "../extensions/pi-event-loop/automator.js";
import { parseEventLoopConfig } from "../extensions/pi-event-loop/config.js";
import {
	deliverNextCommand,
	settleActiveCommand,
} from "../extensions/pi-event-loop/dispatcher.js";
import {
	type EmissionContext,
	evaluateEmission,
} from "../extensions/pi-event-loop/event-ingress.js";
import { readEventLog } from "../extensions/pi-event-loop/event-log.js";
import { eventChainDepth } from "../extensions/pi-event-loop/loop-guards.js";
import { createEventLoopRuntime } from "../extensions/pi-event-loop/runtime.js";
import {
	buildSnapshot,
	recoverSessionState,
} from "../extensions/pi-event-loop/session-state.js";
import { readLatestSnapshot } from "../extensions/pi-event-loop/snapshot-format.js";
import {
	COMMAND_MESSAGE_CUSTOM_TYPE,
	EVENT_LOOP_EVENT_CUSTOM_TYPE,
	type EventLoopConfig,
	type LoopEventData,
	type ProfileConfig,
	SNAPSHOT_CUSTOM_TYPE,
} from "../extensions/pi-event-loop/types.js";
import {
	CONFIG,
	workCompleted,
	workRequested,
} from "./fixtures/pi-event-loop.js";

/** Full runtime cycle: request → queue → deliver → outcome → complete (SPEC §5). */
describe("pi-event-loop runtime cycle", () => {
	it("runs request → queue → deliver → outcome → completed without domain branching", async () => {
		const runtime = createEventLoopRuntime();
		const pipeline = createPostAppendPipeline(runtime);

		// 1. An operator/system fact opens work; the automator queues its command.
		pipeline(workRequested("work-1"), CONFIG, "default");
		expect(runtime.queue).toHaveLength(1);

		// 2. Delivery marks the item dispatched and produces the self-describing message.
		const sent: Array<{
			customType: string;
			details: { expectedEvents: readonly string[] };
		}> = [];
		const outcome = await deliverNextCommand(
			{ sendMessage: async (message) => void sent.push(message) },
			runtime,
		);
		expect(outcome.delivered).toBe(true);
		const message = sent[0];
		expect(message?.customType).toBe(COMMAND_MESSAGE_CUSTOM_TYPE);
		expect(message?.details.expectedEvents).toEqual([
			"work.completed",
			"work.failed",
		]);
		const itemId = [...runtime.projection.order][0];
		const item =
			itemId !== undefined ? runtime.projection.items.get(itemId) : undefined;
		expect(item?.status).toBe("dispatched");

		// 3. The agent emits the expected outcome; the projection completes the item.
		pipeline(workCompleted("work-1"), CONFIG, "default");
		const completedItem =
			itemId !== undefined ? runtime.projection.items.get(itemId) : undefined;
		expect(completedItem?.status).toBe("completed");
		expect(completedItem?.completedByEventId).toBe(
			workCompleted("work-1").eventId,
		);

		// 4. Settlement clears the active command; nothing is left queued or paused.
		const settled = settleActiveCommand(runtime, true);
		expect(settled).toEqual({ settled: true, stalled: false });
		expect(runtime.queue).toHaveLength(0);
		expect(runtime.paused).toBe(false);
	});

	it("stalls and pauses when the command turn settles without an expected outcome", async () => {
		const runtime = createEventLoopRuntime();
		createPostAppendPipeline(runtime)(
			workRequested("work-1"),
			CONFIG,
			"default",
		);
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

		const entries: readonly {
			type: string;
			customType: string;
			data: unknown;
		}[] = [
			{
				type: "custom",
				customType: EVENT_LOOP_EVENT_CUSTOM_TYPE,
				data: decision.event,
			},
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

/** Snapshot persistence and recovery across the modules (SPEC §15, AC-7, AC-18, AC-19). */
describe("pi-event-loop session persistence and recovery", () => {
	it("replays only events after the checkpoint and converges on the full replay (AC-18, AC-7)", () => {
		const first = workRequested("work-1");
		const second = workRequested("work-2");
		const original = createEventLoopRuntime();
		const pipeline = createPostAppendPipeline(original);
		pipeline(first, CONFIG, "default");

		// Checkpoint after the first event, before the second is appended.
		const snapshot = buildSnapshot({
			runtime: original,
			config: CONFIG,
			fingerprint: "fp-1",
			recentEventIds: [first.eventId],
		});
		const entries = [snapshotEntry(snapshot), eventEntry(second)];

		const recovered = createEventLoopRuntime();
		const events = readEventLog([eventEntry(first), ...entries]);
		const outcome = recoverSessionState({
			runtime: recovered,
			events,
			config: CONFIG,
			fingerprint: "fp-1",
			snapshot: readLatestSnapshot(entries),
			applyEvent: createPostAppendPipeline(recovered),
		});
		expect(outcome).toEqual({ mode: "restored", replayedEventCount: 1 });

		const full = createEventLoopRuntime();
		const fullPipeline = createPostAppendPipeline(full);
		fullPipeline(first, CONFIG, "default");
		fullPipeline(second, CONFIG, "default");
		// Replaying the same history converges on byte-equivalent view state (AC-7).
		expect(recovered.projection.items).toEqual(full.projection.items);
		expect(recovered.projection.order).toEqual(full.projection.order);
		expect(recovered.queue.map((record) => record.commandId)).toEqual(
			full.queue.map((record) => record.commandId),
		);
	});

	it("rebuilds every projection after a configuration fingerprint change (AC-19)", () => {
		const first = workRequested("work-1");
		const original = createEventLoopRuntime();
		createPostAppendPipeline(original)(first, CONFIG, "default");
		const snapshot = {
			...buildSnapshot({
				runtime: original,
				config: CONFIG,
				fingerprint: "fp-old",
				recentEventIds: [first.eventId],
			}),
			configFingerprint: "fp-old",
		};

		const recovered = createEventLoopRuntime();
		const outcome = recoverSessionState({
			runtime: recovered,
			events: [first],
			config: CONFIG,
			fingerprint: "fp-new",
			snapshot,
			applyEvent: createPostAppendPipeline(recovered),
		});
		expect(outcome.mode).toBe("rebuilt");
		expect(recovered.projection.items).toEqual(original.projection.items);
		expect(recovered.queue.map((record) => record.commandId)).toEqual(
			original.queue.map((record) => record.commandId),
		);
	});

	it("derives causal chain depth from the projection for loop protection (SPEC §14)", () => {
		const runtime = createEventLoopRuntime();
		const pipeline = createPostAppendPipeline(runtime);
		const request = workRequested("work-1");
		const completion = workCompleted("work-1");
		pipeline(request, CONFIG, "default");
		pipeline(completion, CONFIG, "default");
		expect(eventChainDepth(request.eventId, runtime.projection)).toBe(0);
		expect(eventChainDepth(completion.eventId, runtime.projection)).toBe(1);
	});
});

/** Compensation is expressed as configured facts, views and commands (SPEC §13, AC-22). */
describe("pi-event-loop correction and compensation", () => {
	const COMPENSATION_PROFILE: ProfileConfig = {
		emissionPolicy: "command-contract",
		events: {
			"review.accepted": {
				description: "The review accepted the completed work.",
				allowAgentEmit: true,
				requiredPayload: ["workId"],
			},
			"review.acceptance-retracted": {
				description: "A previously accepted review is retracted.",
				allowAgentEmit: true,
				allowWithoutCommand: true,
				requiredPayload: ["workId", "correctsEventId"],
			},
			"review-correction.completed": {
				description: "The review correction completed.",
				allowAgentEmit: true,
				requiredPayload: ["workId"],
			},
			"review-correction.failed": {
				description: "The review correction failed.",
				allowAgentEmit: true,
				requiredPayload: ["workId", "reason"],
			},
		},
		commands: {
			"correct-review": {
				message: "Correct the retracted review.",
				expectedEvents: [
					"review-correction.completed",
					"review-correction.failed",
				],
			},
		},
		views: {
			"corrections-due": {
				type: "todo",
				openOn: [{ event: "review.acceptance-retracted", keyFrom: "/workId" }],
				closeOn: [
					{ event: "review-correction.completed", keyFrom: "/workId" },
					{ event: "review-correction.failed", keyFrom: "/workId" },
				],
			},
		},
		automations: [
			{
				id: "correct-review",
				view: "corrections-due",
				issue: "correct-review",
			},
		],
		timers: [],
	};

	const COMPENSATION_CONFIG: EventLoopConfig = {
		version: 1,
		activeProfile: "default",
		profiles: { default: COMPENSATION_PROFILE },
		limits: CONFIG.limits,
	};

	it("accepts correctsEventId compensation facts as a normal configured slice", () => {
		const runtime = createEventLoopRuntime();
		const pipeline = createPostAppendPipeline(runtime);
		const entries: Array<{ type: string; customType: string; data: unknown }> =
			[];

		// The original acceptance is retained as history (no rewrite, no pretend-undo).
		const acceptance: LoopEventData = {
			eventId: "evt-original-acceptance",
			type: "review.accepted",
			occurredAt: "2026-01-01T00:00:00.000Z",
			source: "agent",
			payload: { workId: "work-42" },
		};
		entries.push(eventEntry(acceptance));

		// The retraction is validated through the normal ingress path.
		const retraction: LoopEventData = {
			eventId: "evt-retraction",
			type: "review.acceptance-retracted",
			occurredAt: "2026-01-01T01:00:00.000Z",
			source: "operator",
			payload: { workId: "work-42", correctsEventId: acceptance.eventId },
		};
		const decision = evaluateEmission(
			{
				config: COMPENSATION_CONFIG,
				profileName: "default",
				source: "operator",
				activeCommand: undefined,
				activeWorkItem: undefined,
				knownEventIds: new Set([acceptance.eventId]),
				now: () => "2026-01-01T01:00:00.000Z",
			},
			{
				event: "review.acceptance-retracted",
				dedupeKey: "retract-work-42",
				payload: { workId: "work-42", correctsEventId: acceptance.eventId },
			},
		);
		expect(decision.ok).toBe(true);
		entries.push(eventEntry(decision.ok ? decision.event : retraction));
		pipeline(
			decision.ok ? decision.event : retraction,
			COMPENSATION_CONFIG,
			"default",
		);

		// The retraction opened a CorrectionsDue row and queued its command.
		const item = [...runtime.projection.items.values()][0];
		expect(item?.viewId).toBe("corrections-due");
		expect(item?.key).toBe("work-42");
		expect(runtime.queue).toHaveLength(1);
		expect(runtime.queue[0]?.type).toBe("correct-review");
		// History was never rewritten: the original fact is still in the log.
		const logged = readEventLog(entries);
		expect(logged.some((event) => event.eventId === acceptance.eventId)).toBe(
			true,
		);
	});

	it("cancels a queued undelivered command once its item completes (SPEC §13)", () => {
		const runtime = createEventLoopRuntime();
		const pipeline = createPostAppendPipeline(runtime);
		const retraction: LoopEventData = {
			eventId: "evt-retraction",
			type: "review.acceptance-retracted",
			occurredAt: "2026-01-01T01:00:00.000Z",
			source: "operator",
			payload: { workId: "work-42", correctsEventId: "evt-original" },
		};
		pipeline(retraction, COMPENSATION_CONFIG, "default");
		expect(runtime.queue).toHaveLength(1);

		// The correction slice completes the item; the queued command is cancelled.
		const correction: LoopEventData = {
			eventId: "evt-correction-completed",
			type: "review-correction.completed",
			occurredAt: "2026-01-01T02:00:00.000Z",
			source: "agent",
			payload: { workId: "work-42" },
		};
		pipeline(correction, COMPENSATION_CONFIG, "default");
		expect(runtime.queue).toHaveLength(1);
		expect(runtime.queue[0]?.status).toBe("cancelled");
		const item = [...runtime.projection.items.values()][0];
		expect(item?.status).toBe("completed");
		expect(item?.completedByEventId).toBe(correction.eventId);
	});
});

function emissionContext(
	knownEventIds: readonly string[] = [],
): EmissionContext {
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

function eventEntry(event: LoopEventData): {
	type: string;
	customType: string;
	data: LoopEventData;
} {
	return {
		type: "custom",
		customType: EVENT_LOOP_EVENT_CUSTOM_TYPE,
		data: event,
	};
}

function snapshotEntry(snapshot: ReturnType<typeof buildSnapshot>): {
	type: string;
	customType: string;
	data: unknown;
} {
	return { type: "custom", customType: SNAPSHOT_CUSTOM_TYPE, data: snapshot };
}
