/** Tests for snapshot narrowing and persistence format (SPEC §15). */

import { describe, expect, it } from "vitest";
import {
	CONFIG,
	itemIdOf,
	projectedItem,
	runtimeWithHistory,
	snapshotEntry,
	workRequested,
} from "../../../tests/fixtures/pi-event-loop.js";
import { applySnapshotToRuntime, buildSnapshot } from "../session-state.js";
import { asSnapshot, readLatestSnapshot } from "../snapshot-format.js";
import type { EventLoopSnapshot, TodoItem } from "../types.js";

describe("buildSnapshot", () => {
	it("captures projection, queue, pause state, counters and timer state (SPEC §15)", () => {
		const first = workRequested("work-1");
		const second = workRequested("work-2");
		const { runtime } = runtimeWithHistory([first, second]);
		runtime.paused = true;
		runtime.pauseReason = "missing-outcome: test";
		runtime.consecutiveAutomatedTurns = 3;
		runtime.timerState.tick = { lastIntervalFiredAt: 123 };

		const snapshot = buildSnapshot({
			runtime,
			config: CONFIG,
			fingerprint: "fp-1",
			recentEventIds: [first.eventId, second.eventId],
		});
		expect(snapshot.schemaVersion).toBe(1);
		expect(snapshot.profileName).toBe("default");
		expect(snapshot.configFingerprint).toBe("fp-1");
		expect(snapshot.projectedEventCount).toBe(2);
		expect(snapshot.lastAppliedEventId).toBe(second.eventId);
		expect(snapshot.items).toEqual([
			projectedItem(first, "work-1"),
			projectedItem(second, "work-2"),
		]);
		expect(snapshot.pendingCommands).toHaveLength(2);
		expect(snapshot.activeCommand).toBeUndefined();
		expect(snapshot.recentEventIds).toEqual([first.eventId, second.eventId]);
		expect(snapshot.timerState).toEqual({ tick: { lastIntervalFiredAt: 123 } });
		expect(snapshot.paused).toBe(true);
		expect(snapshot.pauseReason).toBe("missing-outcome: test");
		expect(snapshot.consecutiveAutomatedTurns).toBe(3);
	});

	it("bounds the view snapshot: live items plus the most recent completed tail", () => {
		const items = new Map<string, TodoItem>();
		const order: string[] = [];
		for (let index = 0; index < 150; index++) {
			items.set(`item-closed-${index}`, {
				...projectedItem(workRequested(`w-${index}`), `w-${index}`),
				workItemId: `item-closed-${index}`,
				status: "completed",
			});
			order.push(`item-closed-${index}`);
		}
		items.set("item-live", {
			...projectedItem(workRequested("w-live"), "w-live"),
			workItemId: "item-live",
		});
		order.push("item-live");

		const snapshot = buildSnapshot({
			runtime: { ...emptyRuntime(), projection: { items, order } },
			config: CONFIG,
			fingerprint: "fp-1",
			recentEventIds: [],
		});
		expect(snapshot.items).toHaveLength(101);
		const keys = snapshot.items.map((item) => item.key);
		expect(keys).toContain("w-live");
		expect(keys).not.toContain("w-0");
		expect(keys).toContain("w-149");
	});

	it("persists only queued commands as pending and the delivered command as active", () => {
		const { runtime } = runtimeWithHistory([workRequested("work-1")]);
		const queued = runtime.queue[0];
		if (queued === undefined) {
			throw new Error("fixture broken: no queued command");
		}
		runtime.queue = [];
		runtime.activeCommand = { ...queued, status: "active" };

		const snapshot = buildSnapshot({
			runtime,
			config: CONFIG,
			fingerprint: "fp-1",
			recentEventIds: [],
		});
		expect(snapshot.pendingCommands).toHaveLength(0);
		expect(snapshot.activeCommand).toEqual({
			...queued,
			status: "active",
		});
	});
});

function emptyRuntime(): ReturnType<typeof runtimeWithHistory>["runtime"] {
	return runtimeWithHistory([]).runtime;
}

describe("asSnapshot", () => {
	it("round-trips a built snapshot through JSON", () => {
		const { runtime } = runtimeWithHistory([workRequested("work-1")]);
		runtime.timerState.tick = { lastIntervalFiredAt: 42 };
		const snapshot = buildSnapshot({
			runtime,
			config: CONFIG,
			fingerprint: "fp-1",
			recentEventIds: [],
		});
		const parsed = asSnapshot(JSON.parse(JSON.stringify(snapshot)));
		expect(parsed).toEqual(snapshot);
	});

	it("rejects malformed snapshot data instead of repairing it", () => {
		expect(asSnapshot(undefined)).toBeUndefined();
		expect(asSnapshot({ schemaVersion: 2 })).toBeUndefined();
		expect(asSnapshot({ schemaVersion: 1 })).toBeUndefined();
		expect(
			asSnapshot({
				schemaVersion: 1,
				profileName: "default",
				configFingerprint: "fp",
				projectedEventCount: 0,
				paused: false,
				consecutiveAutomatedTurns: 0,
				items: [{ workItemId: "nope" }],
				pendingCommands: [],
				recentEventIds: [],
				timerState: {},
			}),
		).toBeUndefined();
		expect(
			asSnapshot({
				schemaVersion: 1,
				profileName: "default",
				configFingerprint: "fp",
				projectedEventCount: 0,
				paused: false,
				consecutiveAutomatedTurns: 0,
				items: [],
				pendingCommands: [{ commandId: "cmd-1" }],
				recentEventIds: [],
				timerState: {},
			}),
		).toBeUndefined();
	});
});

describe("readLatestSnapshot", () => {
	it("returns the latest valid snapshot and ignores corrupt entries (SPEC §15)", () => {
		const early = snapshotOf([workRequested("work-1")]);
		const laterSession = snapshotOf([
			workRequested("work-1"),
			workRequested("work-2"),
		]);
		const corrupt = snapshotEntry({ schemaVersion: 1, broken: true });
		const latestSnapshot = readLatestSnapshot([early, corrupt, laterSession]);
		expect(
			(latestSnapshot as EventLoopSnapshot | undefined)?.items,
		).toHaveLength(2);
	});

	it("falls back to the last valid entry when a corrupt tail follows it", () => {
		const good = snapshotOf([workRequested("work-1")]);
		const corrupt = snapshotEntry("not-an-object");
		expect(readLatestSnapshot([good, corrupt])).toEqual(
			good.data as EventLoopSnapshot,
		);
		expect(readLatestSnapshot([corrupt])).toBeUndefined();
	});
});

describe("applySnapshotToRuntime", () => {
	it("restores projection, queue, active command, pause state and counters", () => {
		const request = workRequested("work-1");
		const { runtime } = runtimeWithHistory([request]);
		const queued = runtime.queue[0];
		if (queued === undefined) {
			throw new Error("fixture broken: no queued command");
		}
		runtime.queue = [];
		runtime.activeCommand = { ...queued, status: "active" };
		runtime.activeWorkItem = projectedItem(request, "work-1");
		runtime.paused = true;
		runtime.pauseReason = "open-item-limit: test";
		runtime.consecutiveAutomatedTurns = 2;
		runtime.timerState.tick = { lastDailyDate: "2026-01-01" };
		const snapshot = buildSnapshot({
			runtime,
			config: CONFIG,
			fingerprint: "fp-1",
			recentEventIds: [],
		});

		const restored = emptyRuntime();
		applySnapshotToRuntime(restored, snapshot);
		expect(restored.projection.items.get(itemIdOf(request, "work-1"))).toEqual(
			projectedItem(request, "work-1"),
		);
		expect(restored.queue).toHaveLength(0);
		expect(restored.activeCommand?.status).toBe("active");
		expect(restored.activeWorkItem?.key).toBe("work-1");
		expect(restored.paused).toBe(true);
		expect(restored.pauseReason).toBe("open-item-limit: test");
		expect(restored.consecutiveAutomatedTurns).toBe(2);
		expect(restored.projectedEventCount).toBe(snapshot.projectedEventCount);
		expect(restored.timerState).toEqual({
			tick: { lastDailyDate: "2026-01-01" },
		});
	});
});

function snapshotOf(events: Parameters<typeof runtimeWithHistory>[0]) {
	const { runtime } = runtimeWithHistory(events);
	const snapshot = buildSnapshot({
		runtime,
		config: CONFIG,
		fingerprint: "fp-1",
		recentEventIds: events.map((event) => event.eventId),
	});
	return snapshotEntry(snapshot);
}
