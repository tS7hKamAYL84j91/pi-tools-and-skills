/** Tests for pure replayable todo projections (SPEC §9, AC-4..AC-7). */

import { describe, expect, it } from "vitest";

import { applyEvent, replayEvents, type TodoProjection } from "../projector.js";
import {
	findItem,
	markItemDispatched,
	markItemStalled,
	openItemCount,
	outstandingItems,
} from "../todo-view.js";
import {
	deriveEventId,
	type EventLoopConfig,
	type LoopEventData,
} from "../types.js";

const PROFILE = {
	emissionPolicy: "command-contract" as const,
	events: {
		"work.requested": {
			description: "Work ready.",
			allowAgentEmit: false,
			requiredPayload: ["workId"],
		},
		"work.completed": {
			description: "Work done.",
			allowAgentEmit: true,
			requiredPayload: ["workId", "resultPath"],
		},
		"work.failed": {
			description: "Work failed.",
			allowAgentEmit: true,
			requiredPayload: ["workId", "reason"],
		},
		"review.accepted": {
			description: "Review accepted.",
			allowAgentEmit: true,
			requiredPayload: ["workId"],
		},
		"unmapped.note": {
			description: "A fact no view maps.",
			allowAgentEmit: true,
			requiredPayload: [],
		},
	},
	commands: {},
	views: {
		"work-due": {
			type: "todo" as const,
			openOn: [{ event: "work.requested", keyFrom: "/workId" }],
			closeOn: [
				{ event: "work.completed", keyFrom: "/workId" },
				{ event: "work.failed", keyFrom: "/workId" },
			],
		},
		"reviews-due": {
			type: "todo" as const,
			openOn: [{ event: "work.completed", keyFrom: "/workId" }],
			closeOn: [{ event: "review.accepted", keyFrom: "/workId" }],
		},
	},
	automations: [],
	timers: [],
};

const CONFIG: EventLoopConfig = {
	version: 1,
	activeProfile: "default",
	profiles: { default: PROFILE },
	limits: {
		maxPendingCommands: 20,
		maxOpenItemsPerView: 100,
		maxPayloadBytes: 1024,
		maxChainDepth: 12,
		maxConsecutiveTurns: 8,
		maxRecentEvents: 1000,
	},
};

let sequence = 0;
function event(
	type: string,
	payload: Record<string, unknown>,
	source: LoopEventData["source"] = "operator",
): LoopEventData {
	sequence++;
	return {
		eventId: deriveEventId("default", type, `seq-${sequence}`),
		type,
		occurredAt: `2026-09-04T14:00:${String(sequence % 60).padStart(2, "0")}Z`,
		source,
		payload,
	};
}

function workRequested(workId: string): LoopEventData {
	return event("work.requested", { workId });
}

function workCompleted(workId: string): LoopEventData {
	return event("work.completed", {
		workId,
		resultPath: `results/${workId}.json`,
	});
}

describe("todo projections", () => {
	it("creates exactly one deterministic item per opening event (AC-5)", () => {
		const open = workRequested("work-42");
		const projection = replayEvents(CONFIG, "default", [open]);
		const ids = projection.order;
		expect(ids).toHaveLength(1);
		const item = findItem(projection, ids[0] ?? "");
		expect(item?.viewId).toBe("work-due");
		expect(item?.key).toBe("work-42");
		expect(item?.status).toBe("outstanding");
		expect(item?.openedByEventId).toBe(open.eventId);
		// Deterministic: replaying again yields identical ids.
		const replay = replayEvents(CONFIG, "default", [open]);
		expect([...replay.items.keys()]).toEqual([...projection.items.keys()]);
	});

	it("identity includes the opening event id, so duplicate openings create separate rows", () => {
		const projection = replayEvents(CONFIG, "default", [
			workRequested("work-9"),
			workRequested("work-9"),
			workCompleted("work-9"),
		]);
		const dueRows = [...projection.items.values()].filter(
			(item) => item.viewId === "work-due",
		);
		expect(dueRows).toHaveLength(2);
		expect(dueRows.every((item) => item.status === "completed")).toBe(true);
		expect(outstandingItems(projection, "work-due")).toEqual([]);
	});

	it("closes matching open rows without fabricating items (AC-6)", () => {
		const projection = replayEvents(CONFIG, "default", [
			workRequested("work-1"),
			workRequested("work-2"),
			workCompleted("work-1"),
		]);
		expect(
			outstandingItems(projection, "work-due").map((item) => item.key),
		).toEqual(["work-2"]);
		const closed = [...projection.items.values()].find(
			(item) => item.key === "work-1",
		);
		expect(closed?.status).toBe("completed");
		expect(closed?.completedByEventId).toEqual(expect.any(String));
	});

	it("a close-only event for an unknown key fabricates no rows", () => {
		const projection = replayEvents(CONFIG, "default", [
			event("review.accepted", { workId: "ghost" }),
		]);
		expect(projection.items.size).toBe(0);
		expect(projection.order).toEqual([]);
	});

	it("a fact that maps to no view is retained history with no effects (AC-4)", () => {
		const projection = replayEvents(CONFIG, "default", [
			event("unmapped.note", { text: "hello" }),
		]);
		expect(projection.items.size).toBe(0);
	});

	it("one event can update several views", () => {
		const projection = replayEvents(CONFIG, "default", [
			workRequested("work-7"),
			workCompleted("work-7"),
		]);
		expect(outstandingItems(projection, "work-due")).toEqual([]);
		expect(
			outstandingItems(projection, "reviews-due").map((item) => item.key),
		).toEqual(["work-7"]);
	});

	it("replaying the same history is byte-equivalent (AC-7)", () => {
		const events = [
			workRequested("a"),
			workCompleted("a"),
			workRequested("b"),
			workRequested("c"),
			event("review.accepted", { workId: "a" }),
		];
		const serialize = (projection: TodoProjection) =>
			JSON.stringify(projection.order) +
			"|" +
			JSON.stringify([...projection.items.entries()]);
		expect(serialize(replayEvents(CONFIG, "default", events))).toBe(
			serialize(replayEvents(CONFIG, "default", events)),
		);
	});

	it("incremental applyEvent matches full replay", () => {
		const events = [workRequested("x"), workCompleted("x"), workRequested("y")];
		const full = replayEvents(CONFIG, "default", events);
		let incremental: TodoProjection = { items: new Map(), order: [] };
		for (const item of events) {
			incremental = applyEvent(incremental, CONFIG, "default", item);
		}
		expect(JSON.stringify([...incremental.items.entries()])).toBe(
			JSON.stringify([...full.items.entries()]),
		);
		expect(incremental.order).toEqual(full.order);
	});

	it("configuration order does not change the result", () => {
		const reversedProfile = {
			...PROFILE,
			views: {
				"reviews-due": PROFILE["views"]["reviews-due"],
				"work-due": PROFILE["views"]["work-due"],
			},
			events: {
				"review.accepted": PROFILE["events"]["review.accepted"],
				"unmapped.note": PROFILE["events"]["unmapped.note"],
				"work.failed": PROFILE["events"]["work.failed"],
				"work.completed": PROFILE["events"]["work.completed"],
				"work.requested": PROFILE["events"]["work.requested"],
			},
		};
		const reversedConfig: EventLoopConfig = {
			...CONFIG,
			profiles: { default: reversedProfile },
		};
		const events = [
			workRequested("a"),
			workCompleted("a"),
			event("review.accepted", { workId: "a" }),
		];
		const serialize = (projection: TodoProjection) =>
			JSON.stringify([...projection.items.entries()]);
		expect(serialize(replayEvents(CONFIG, "default", events))).toBe(
			serialize(replayEvents(reversedConfig, "default", events)),
		);
	});

	it("dispatch and stall transitions keep other rows untouched", () => {
		const base = replayEvents(CONFIG, "default", [
			workRequested("a"),
			workRequested("b"),
		]);
		const ids = base.order;
		const dispatched = markItemDispatched(base, ids[0] ?? "", "cmd-1");
		expect(findItem(dispatched, ids[0] ?? "")?.status).toBe("dispatched");
		expect(findItem(dispatched, ids[0] ?? "")?.commandId).toBe("cmd-1");
		expect(findItem(dispatched, ids[1] ?? "")?.status).toBe("outstanding");
		const stalled = markItemStalled(dispatched, ids[0] ?? "");
		expect(findItem(stalled, ids[0] ?? "")?.status).toBe("stalled");
		expect(openItemCount(stalled, "work-due")).toBe(2);
		const closed = applyEvent(stalled, CONFIG, "default", workCompleted("a"));
		expect(findItem(closed, ids[0] ?? "")?.status).toBe("completed");
		expect(openItemCount(closed, "work-due")).toBe(1);
		expect(
			outstandingItems(closed, "work-due").map((item) => item.key),
		).toEqual(["b"]);
	});

	it("missing required payload key in an opening event creates no row", () => {
		const projection = replayEvents(CONFIG, "default", [
			event("work.requested", {} as Record<string, unknown>),
		]);
		expect(projection.items.size).toBe(0);
	});
});
