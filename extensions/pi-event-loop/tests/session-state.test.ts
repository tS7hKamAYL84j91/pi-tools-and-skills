/** Tests for session-state recovery: restore, replay, rebuild (SPEC §11, §15). */

import { describe, expect, it } from "vitest";
import {
	agentOutcome,
	CONFIG,
	itemIdOf,
	projectedItem,
	runtimeWithHistory,
	workCompleted,
	workRequested,
} from "../../../tests/fixtures/pi-event-loop.js";
import { createPostAppendPipeline } from "../automator.js";
import { createEventLoopRuntime, resetEventLoopRuntime } from "../runtime.js";
import {
	buildSnapshot,
	recoverSessionState,
	requeueActiveCommand,
} from "../session-state.js";

/** Build the typed checkpoint snapshot for a runtime over the given history. */
function snapshotFor(
	runtime: ReturnType<typeof runtimeWithHistory>["runtime"],
	events: readonly ReturnType<typeof workRequested>[],
): ReturnType<typeof buildSnapshot> {
	return buildSnapshot({
		runtime,
		config: CONFIG,
		fingerprint: "fp-1",
		recentEventIds: events.map((event) => event.eventId),
	});
}

describe("recoverSessionState", () => {
	it("replays the full history when no snapshot exists (SPEC §15)", () => {
		const first = workRequested("work-1");
		const second = workRequested("work-2");
		const runtime = createEventLoopRuntime();
		const outcome = recoverSessionState({
			runtime,
			events: [first, second],
			config: CONFIG,
			fingerprint: "fp-1",
			snapshot: undefined,
			applyEvent: createPostAppendPipeline(runtime),
		});
		expect(outcome.mode).toBe("rebuilt");
		expect(outcome.replayedEventCount).toBe(2);
		expect([...runtime.projection.items.values()]).toEqual([
			projectedItem(first, "work-1"),
			projectedItem(second, "work-2"),
		]);
		expect(runtime.queue).toHaveLength(2);
	});

	it("restores the snapshot and replays only later events (SPEC §15, AC-18)", () => {
		const first = workRequested("work-1");
		const later = workRequested("work-2");
		const before = runtimeWithHistory([first]);
		const snapshot = snapshotFor(before.runtime, [first]);

		const restored = createEventLoopRuntime();
		const outcome = recoverSessionState({
			runtime: restored,
			events: [first, later],
			config: CONFIG,
			fingerprint: "fp-1",
			snapshot,
			applyEvent: createPostAppendPipeline(restored),
		});
		expect(outcome).toEqual({ mode: "restored", replayedEventCount: 1 });
		expect(restored.projectedEventCount).toBe(2);
		expect([...restored.projection.items.values()]).toEqual([
			projectedItem(first, "work-1"),
			projectedItem(later, "work-2"),
		]);
		expect(restored.queue).toHaveLength(2);
	});

	it("cancels queued commands whose items completed during replay (SPEC §13)", () => {
		const request = workRequested("work-1");
		const before = runtimeWithHistory([request]);
		const snapshot = snapshotFor(before.runtime, [request]);
		const completed = agentOutcome({
			type: "work.completed",
			payload: { workId: "work-1", resultPath: "out/x.md" },
			commandId: "cmd-x",
			workItemId: itemIdOf(request, "work-1"),
			correlationId: "work-1",
		});

		const restored = createEventLoopRuntime();
		const outcome = recoverSessionState({
			runtime: restored,
			events: [request, completed],
			config: CONFIG,
			fingerprint: "fp-1",
			snapshot,
			applyEvent: createPostAppendPipeline(restored),
		});
		expect(outcome).toEqual({ mode: "restored", replayedEventCount: 1 });
		const item = restored.projection.items.get(itemIdOf(request, "work-1"));
		expect(item?.status).toBe("completed");
		expect(restored.queue).toHaveLength(1);
		expect(restored.queue[0]?.status).toBe("cancelled");
		expect(restored.paused).toBe(false);
	});

	it("rebuilds every projection when the configuration fingerprint changed (SPEC §15, AC-19)", () => {
		const first = workRequested("work-1");
		const second = workRequested("work-2");
		const before = runtimeWithHistory([first, second]);
		const snapshot = {
			...snapshotFor(before.runtime, [first, second]),
			configFingerprint: "fp-changed",
		};

		const restored = createEventLoopRuntime();
		const outcome = recoverSessionState({
			runtime: restored,
			events: [first, second],
			config: CONFIG,
			fingerprint: "fp-1",
			snapshot,
			applyEvent: createPostAppendPipeline(restored),
		});
		expect(outcome).toEqual({ mode: "rebuilt", replayedEventCount: 2 });
		expect([...restored.projection.items.values()]).toEqual([
			projectedItem(first, "work-1"),
			projectedItem(second, "work-2"),
		]);
		expect(restored.queue).toHaveLength(2);
		// A rebuild is a clean slate: the old pause referenced obsolete commands, and
		// automation resumes per SPEC §17.
		expect(restored.paused).toBe(false);
		expect(restored.pauseReason).toBeUndefined();
	});

	it("rebuilds when the checkpoint event is missing from the branch", () => {
		const before = runtimeWithHistory([workRequested("work-1")]);
		const snapshot = snapshotFor(before.runtime, [workRequested("work-1")]);

		const restored = createEventLoopRuntime();
		const outcome = recoverSessionState({
			runtime: restored,
			events: [workRequested("work-9")],
			config: CONFIG,
			fingerprint: "fp-1",
			snapshot,
			applyEvent: createPostAppendPipeline(restored),
		});
		expect(outcome).toEqual({ mode: "rebuilt", replayedEventCount: 1 });
		expect(
			restored.projection.items.has(
				itemIdOf(workRequested("work-9"), "work-9"),
			),
		).toBe(true);
		expect(
			restored.projection.items.has(
				itemIdOf(workRequested("work-1"), "work-1"),
			),
		).toBe(false);
	});

	it("produces a projection equal to a full replay after restore (AC-7, AC-19)", () => {
		const first = workRequested("work-1");
		const completion = workCompleted("work-1");
		const second = workRequested("work-2");
		const events = [first, completion, second];
		const beforeOne = runtimeWithHistory([first]);
		const snapshotAtOne = snapshotFor(beforeOne.runtime, [first]);

		const restored = createEventLoopRuntime();
		recoverSessionState({
			runtime: restored,
			events,
			config: CONFIG,
			fingerprint: "fp-1",
			snapshot: snapshotAtOne,
			applyEvent: createPostAppendPipeline(restored),
		});
		const fullReplay = runtimeWithHistory(events);
		expect([...restored.projection.items.values()]).toEqual([
			...fullReplay.runtime.projection.items.values(),
		]);
		expect(restored.projection.order).toEqual(
			fullReplay.runtime.projection.order,
		);
	});

	it("preserves all completed rows and projection byte-equivalence beyond 100 completed rows on recovery (SPEC §15, AC-7, AC-18)", () => {
		// 105 completed work items before checkpoint
		const events: ReturnType<typeof workRequested>[] = [];
		for (let i = 0; i < 105; i++) {
			events.push(workRequested(`work-${i}`), workCompleted(`work-${i}`));
		}
		const before = runtimeWithHistory(events);
		const snapshot = snapshotFor(before.runtime, events);

		const later = workRequested("work-extra");
		const allEvents = [...events, later];
		const restored = createEventLoopRuntime();
		recoverSessionState({
			runtime: restored,
			events: allEvents,
			config: CONFIG,
			fingerprint: "fp-1",
			snapshot,
			applyEvent: createPostAppendPipeline(restored),
		});

		const fullReplay = runtimeWithHistory(allEvents);
		expect(restored.projection.items.size).toBe(106);
		expect([...restored.projection.items.values()]).toEqual([
			...fullReplay.runtime.projection.items.values(),
		]);
		expect(restored.projection.order).toEqual(
			fullReplay.runtime.projection.order,
		);
	});

	it("keeps two sessions independent (AC-23)", () => {
		const runtimeA = createEventLoopRuntime();
		const runtimeB = createEventLoopRuntime();
		const pipelineA = createPostAppendPipeline(runtimeA);
		const pipelineB = createPostAppendPipeline(runtimeB);
		pipelineA(workRequested("work-a"), CONFIG, "default");
		pipelineB(workRequested("work-b"), CONFIG, "default");

		const idA = itemIdOf(workRequested("work-a"), "work-a");
		const idB = itemIdOf(workRequested("work-b"), "work-b");
		expect(runtimeA.projection.items.has(idA)).toBe(true);
		expect(runtimeA.projection.items.has(idB)).toBe(false);
		expect(runtimeB.projection.items.has(idB)).toBe(true);
		expect(runtimeB.projection.items.has(idA)).toBe(false);
		expect(runtimeA.queue).toHaveLength(1);
		expect(runtimeB.queue).toHaveLength(1);
		expect(runtimeA.queue[0]?.commandId).not.toBe(runtimeB.queue[0]?.commandId);
	});
});

describe("requeueActiveCommand", () => {
	it("requeues a delivered-but-unsettled command at the queue head with the same id (SPEC §11)", () => {
		const { runtime } = runtimeWithHistory([
			workRequested("work-1"),
			workRequested("work-2"),
		]);
		const first = runtime.queue[0];
		if (first === undefined) {
			throw new Error("fixture broken: no queued command");
		}
		// Simulate a delivery that removed the command from the queue.
		runtime.queue = runtime.queue.slice(1);
		runtime.activeCommand = { ...first, status: "active" };

		expect(requeueActiveCommand(runtime)).toBe(true);
		expect(runtime.activeCommand).toBeUndefined();
		expect(runtime.queue[0]?.commandId).toBe(first.commandId);
		expect(runtime.queue[0]?.status).toBe("queued");
		expect(runtime.queue).toHaveLength(2);
	});

	it("drops the active command when its outcome already replayed (item completed)", () => {
		const request = workRequested("work-1");
		const { runtime } = runtimeWithHistory([request, workCompleted("work-1")]);
		const item = runtime.projection.items.get(itemIdOf(request, "work-1"));
		if (item === undefined) {
			throw new Error("fixture broken: item missing");
		}
		runtime.activeCommand = {
			commandId: "cmd-for-item-work-1",
			type: "perform-work",
			automationId: "perform",
			workItemId: item.workItemId,
			viewId: "work-due",
			correlationId: "work-1",
			causedBy: item.openedByEventId,
			message: "Perform the work.",
			expectedEvents: ["work.completed", "work.failed"],
			workItem: item.sourcePayload,
			status: "delivered",
		};
		expect(requeueActiveCommand(runtime)).toBe(false);
		expect(runtime.activeCommand).toBeUndefined();
		expect(
			runtime.queue.some(
				(record) => record.commandId === "cmd-for-item-work-1",
			),
		).toBe(false);
	});
});

describe("resetEventLoopRuntime", () => {
	it("clears mutable state in place", () => {
		const { runtime } = runtimeWithHistory([workRequested("work-1")]);
		runtime.paused = true;
		runtime.timerState.tick = { lastIntervalFiredAt: 1 };
		resetEventLoopRuntime(runtime);
		expect(runtime.paused).toBe(false);
		expect(runtime.pauseReason).toBeUndefined();
		expect(runtime.queue).toHaveLength(0);
		expect(runtime.projection.items.size).toBe(0);
		expect(runtime.projectedEventCount).toBe(0);
		expect(runtime.timerState).toEqual({});
		expect(runtime.activeCommand).toBeUndefined();
	});
});
