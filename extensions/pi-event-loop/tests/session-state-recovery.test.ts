/** Tests for session-state bounded recovery and causal lineage preservation (SPEC §14, §15, AC-18). */

import { describe, expect, it } from "vitest";
import {
	CONFIG,
	runtimeWithHistory,
	workCompleted,
	workRequested,
} from "../../../tests/fixtures/pi-event-loop.js";
import { createPostAppendPipeline } from "../automator.js";
import { eventChainDepth } from "../loop-guards.js";
import { createEventLoopRuntime } from "../runtime.js";
import { buildSnapshot, recoverSessionState } from "../session-state.js";
import type { EventLoopConfig, TodoItem } from "../types.js";

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

function makeItem(
	id: string,
	openedBy: string,
	completedBy?: string,
	status: TodoItem["status"] = "completed",
): TodoItem {
	return {
		workItemId: id,
		viewId: "view-a",
		key: id,
		openedByEventId: openedBy,
		completedByEventId: completedBy,
		sourcePayload: {},
		status,
	};
}

const CHAIN_CONFIG: EventLoopConfig = {
	version: 1,
	activeProfile: "default",
	profiles: {
		default: {
			emissionPolicy: "command-contract",
			events: {
				"chain.a": { description: "A", allowAgentEmit: true, requiredPayload: ["key"] },
				"chain.b": { description: "B", allowAgentEmit: true, requiredPayload: ["key"] },
			},
			commands: { "step-cmd": { message: "Step", expectedEvents: ["chain.a", "chain.b"] } },
			views: {
				"view-a": { type: "todo", openOn: [{ event: "chain.a", keyFrom: "/key" }], closeOn: [{ event: "chain.b", keyFrom: "/key" }] },
				"view-b": { type: "todo", openOn: [{ event: "chain.b", keyFrom: "/key" }], closeOn: [{ event: "chain.a", keyFrom: "/key" }] },
			},
			automations: [
				{ id: "auto-a", view: "view-a", issue: "step-cmd" },
				{ id: "auto-b", view: "view-b", issue: "step-cmd" },
			],
			timers: [],
		},
	},
	limits: { ...CONFIG.limits, maxChainDepth: 200 },
};

describe("recoverSessionState bounded lineage (SPEC §14, §15, AC-18)", () => {
	it("bounds historical completed rows while preserving causal depth for live items across recovery", () => {
		// 1) Independent completed items are bounded in the snapshot (SPEC §15)
		const independentEvents: ReturnType<typeof workRequested>[] = [];
		for (let i = 0; i < 105; i++) {
			independentEvents.push(workRequested(`work-${i}`), workCompleted(`work-${i}`));
		}
		const beforeIndependent = runtimeWithHistory(independentEvents);
		const boundedSnapshot = snapshotFor(beforeIndependent.runtime, independentEvents);
		expect(boundedSnapshot.items.length).toBe(100);

		const extra = workRequested("work-extra");
		const restoredIndependent = createEventLoopRuntime();
		const independentOutcome = recoverSessionState({
			runtime: restoredIndependent,
			events: [...independentEvents, extra],
			config: CONFIG,
			fingerprint: "fp-1",
			snapshot: boundedSnapshot,
			applyEvent: createPostAppendPipeline(restoredIndependent),
		});
		expect(independentOutcome.mode).toBe("restored");
		expect(independentOutcome.replayedEventCount).toBe(1);
		expect(restoredIndependent.projection.items.size).toBe(101);

		// 2) 120 sequential causal hops where each event completes previous item and opens next
		const chainRuntime = createEventLoopRuntime();
		const chainPipeline = createPostAppendPipeline(chainRuntime);
		const chainEvents: ReturnType<typeof workRequested>[] = [];
		for (let i = 0; i <= 120; i++) {
			const event: ReturnType<typeof workRequested> = {
				eventId: `evt-${i}`,
				type: i % 2 === 0 ? "chain.a" : "chain.b",
				occurredAt: new Date(1000 + i).toISOString(),
				source: "agent",
				payload: { key: "causal-lineage" },
			};
			chainEvents.push(event);
			chainPipeline(event, CHAIN_CONFIG, "default");
		}

		const chainSnapshot = buildSnapshot({
			runtime: chainRuntime,
			config: CHAIN_CONFIG,
			fingerprint: "fp-chain",
			recentEventIds: chainEvents.map((e) => e.eventId),
		});
		expect(chainSnapshot.items.length).toBe(121);
		expect(chainSnapshot.items.some((it) => it.openedByEventId === "evt-0")).toBe(true);
		expect(chainSnapshot.items.some((it) => it.openedByEventId === "evt-19")).toBe(true);

		// Post-checkpoint events 121..123
		const postEvents: ReturnType<typeof workRequested>[] = [];
		for (let i = 121; i <= 123; i++) {
			postEvents.push({
				eventId: `evt-${i}`,
				type: i % 2 === 0 ? "chain.a" : "chain.b",
				occurredAt: new Date(1000 + i).toISOString(),
				source: "agent",
				payload: { key: "causal-lineage" },
			});
		}

		const restoredChain = createEventLoopRuntime();
		const chainOutcome = recoverSessionState({
			runtime: restoredChain,
			events: [...chainEvents, ...postEvents],
			config: CHAIN_CONFIG,
			fingerprint: "fp-chain",
			snapshot: chainSnapshot,
			applyEvent: createPostAppendPipeline(restoredChain),
		});
		expect(chainOutcome.mode).toBe("restored");
		expect(chainOutcome.replayedEventCount).toBe(3);
		expect(eventChainDepth("evt-123", restoredChain.projection)).toBe(123);

		// 3) When maxChainDepth is small (5), causal ancestors beyond 100-tail are capped
		const cappedConfig: EventLoopConfig = {
			...CHAIN_CONFIG,
			limits: { ...CHAIN_CONFIG.limits, maxChainDepth: 5 },
		};
		const cappedSnapshot = buildSnapshot({
			runtime: chainRuntime,
			config: cappedConfig,
			fingerprint: "fp-chain",
			recentEventIds: chainEvents.map((e) => e.eventId),
		});
		expect(cappedSnapshot.items.length).toBe(101);
		expect(cappedSnapshot.items.some((it) => it.openedByEventId === "evt-0")).toBe(false);
		expect(cappedSnapshot.items.some((it) => it.openedByEventId === "evt-19")).toBe(false);

		const restoredCapped = createEventLoopRuntime();
		recoverSessionState({
			runtime: restoredCapped,
			events: [...chainEvents, ...postEvents],
			config: cappedConfig,
			fingerprint: "fp-chain",
			snapshot: cappedSnapshot,
			applyEvent: createPostAppendPipeline(restoredCapped),
		});
		expect(restoredCapped.paused).toBe(true);
		expect(restoredCapped.pauseReason).toContain("chain-depth");
	});

	it("does not discard shorter causal paths when a node was visited earlier via a longer path (SPEC §14, §15)", () => {
		const runtime = createEventLoopRuntime();
		const items = new Map<string, TodoItem>();
		const order: string[] = [];

		const add = (item: TodoItem) => {
			items.set(item.workItemId, item);
			order.push(item.workItemId);
		};

		// Root ancestor and deep ancestor
		add(makeItem("item-root-ancestor", "evt-super-root", "evt-root"));
		add(makeItem("item-deep-ancestor", "evt-root", "evt-shared"));

		// 100 dummy completed items so deepAncestor is pushed out of the 100-tail
		for (let i = 0; i < 100; i++) {
			add(makeItem(`item-dummy-${i}`, `evt-d-open-${i}`, `evt-d-close-${i}`));
		}

		// Short path (length 1 from shortLive to evt-shared)
		add(makeItem("item-short", "evt-shared", "evt-short-done"));
		add(makeItem("item-short-live", "evt-short-done", undefined, "outstanding"));

		// Long path (length 4 from longLive to evt-shared)
		for (let i = 1; i <= 4; i++) {
			add(makeItem(`item-L${i}`, i === 1 ? "evt-shared" : `evt-L${i - 1}`, `evt-L${i}`));
		}
		add(makeItem("item-long-live", "evt-L4", undefined, "outstanding"));

		runtime.projection = { items, order };

		const config: EventLoopConfig = {
			...CONFIG,
			limits: { ...CONFIG.limits, maxChainDepth: 4 },
		};
		const snapshot = buildSnapshot({ runtime, config, fingerprint: "fp-dag", recentEventIds: [] });

		// rootAncestor MUST be retained because shorter path reaches it at depth 3 (< maxDepth 5),
		// but boolean visitedEvents drops evt-root because longer path reached it at depth 5 first.
		expect(snapshot.items.some((it) => it.workItemId === "item-root-ancestor")).toBe(true);
	});
});
