/** Tests for loop-protection guards over the projection (SPEC §14, AC-21). */

import { describe, expect, it } from "vitest";
import {
	CONFIG,
	workCompleted,
	workRequested,
} from "../../../tests/fixtures/pi-event-loop.js";
import { createPostAppendPipeline } from "../automator.js";
import { eventChainDepth, findOpenItemLimitViolation } from "../loop-guards.js";
import { createEventLoopRuntime } from "../runtime.js";
import type {
	EventLoopConfig,
	LimitsConfig,
	LoopEventData,
	ProfileConfig,
} from "../types.js";

const CHAIN_PROFILE: ProfileConfig = {
	emissionPolicy: "command-contract",
	events: {
		"work.requested": {
			description: "Work requested.",
			allowAgentEmit: false,
			requiredPayload: ["workId"],
		},
		"work.completed": {
			description: "Work completed.",
			allowAgentEmit: true,
			requiredPayload: ["workId", "resultPath"],
		},
		"review.accepted": {
			description: "Review accepted.",
			allowAgentEmit: true,
			requiredPayload: ["workId"],
		},
	},
	commands: {
		"perform-work": {
			message: "Perform.",
			expectedEvents: ["work.completed", "work.failed"],
		},
		"review-work": {
			message: "Review.",
			expectedEvents: ["review.accepted", "review.rejected"],
		},
	},
	views: {
		"work-due": {
			type: "todo",
			openOn: [{ event: "work.requested", keyFrom: "/workId" }],
			closeOn: [
				{ event: "work.completed", keyFrom: "/workId" },
				{ event: "work.failed", keyFrom: "/workId" },
			],
		},
		"reviews-due": {
			type: "todo",
			openOn: [{ event: "work.completed", keyFrom: "/workId" }],
			closeOn: [
				{ event: "review.accepted", keyFrom: "/workId" },
				{ event: "review.rejected", keyFrom: "/workId" },
			],
		},
	},
	automations: [
		{ id: "perform", view: "work-due", issue: "perform-work" },
		{ id: "review", view: "reviews-due", issue: "review-work" },
	],
	timers: [],
};

const CHAIN_CONFIG: EventLoopConfig = {
	version: 1,
	activeProfile: "default",
	profiles: { default: CHAIN_PROFILE },
	limits: CONFIG.limits,
};

/** A review acceptance fixture sharing the completion event's deterministic id shape. */
function reviewAccepted(): LoopEventData {
	return {
		...workCompleted("work-1"),
		eventId: "evt-review-accepted",
		type: "review.accepted",
		payload: { workId: "work-1" },
	};
}

describe("eventChainDepth", () => {
	it("counts causal command hops from the root", () => {
		const runtime = createEventLoopRuntime();
		const pipeline = createPostAppendPipeline(runtime);
		const request = workRequested("work-1");
		const completion = workCompleted("work-1");
		pipeline(request, CHAIN_CONFIG, "default");
		pipeline(completion, CHAIN_CONFIG, "default");
		pipeline(reviewAccepted(), CHAIN_CONFIG, "default");
		expect(eventChainDepth(request.eventId, runtime.projection)).toBe(0);
		expect(eventChainDepth(completion.eventId, runtime.projection)).toBe(1);
		expect(eventChainDepth(reviewAccepted().eventId, runtime.projection)).toBe(
			2,
		);
	});
});

describe("maxChainDepth enforcement", () => {
	it("pauses with an operator-visible reason when exceeded", () => {
		const config: EventLoopConfig = {
			...CHAIN_CONFIG,
			limits: { ...CONFIG.limits, maxChainDepth: 1 },
		};
		const runtime = createEventLoopRuntime();
		const pipeline = createPostAppendPipeline(runtime);
		const request = workRequested("work-1");
		pipeline(request, config, "default");
		expect(runtime.paused).toBe(false);
		pipeline(workCompleted("work-1"), config, "default");
		expect(runtime.paused).toBe(false);
		const acceptance = reviewAccepted();
		pipeline(acceptance, config, "default");
		expect(runtime.paused).toBe(true);
		expect(runtime.pauseReason).toContain("chain-depth");
		expect(runtime.pauseReason).toContain(acceptance.eventId);
	});
});

describe("maxOpenItemsPerView enforcement", () => {
	it("pauses when a view exceeds the limit", () => {
		const config: EventLoopConfig = {
			...CHAIN_CONFIG,
			limits: { ...CONFIG.limits, maxOpenItemsPerView: 1 },
		};
		const runtime = createEventLoopRuntime();
		const pipeline = createPostAppendPipeline(runtime);
		pipeline(workRequested("work-1"), config, "default");
		expect(runtime.paused).toBe(false);
		pipeline(workRequested("work-2"), config, "default");
		expect(runtime.paused).toBe(true);
		expect(runtime.pauseReason).toContain("open-item-limit");
		expect(runtime.pauseReason).toContain("work-due");
	});

	it("findOpenItemLimitViolation reports the first violating view", () => {
		const runtime = createEventLoopRuntime();
		const pipeline = createPostAppendPipeline(runtime);
		pipeline(workRequested("work-1"), CONFIG, "default");
		pipeline(workRequested("work-2"), CONFIG, "default");
		expect(
			findOpenItemLimitViolation(runtime.projection, CONFIG.limits),
		).toBeUndefined();
		const tight: LimitsConfig = { ...CONFIG.limits, maxOpenItemsPerView: 1 };
		const reason = findOpenItemLimitViolation(runtime.projection, tight);
		expect(reason).toContain("open-item-limit");
		expect(reason).toContain("work-due");
	});
});
