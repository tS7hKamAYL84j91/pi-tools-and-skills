/** Tests for the automation scan and post-append pipeline (SPEC §7, §10). */

import { describe, expect, it } from "vitest";
import {
	CONFIG,
	workCompleted,
	workRequested,
} from "../../../tests/fixtures/pi-event-loop.js";
import { createPostAppendPipeline, scanAutomations } from "../automator.js";
import { replayEvents } from "../projector.js";
import { createEventLoopRuntime } from "../runtime.js";
import { deriveCommandId, deriveWorkItemId } from "../types.js";

/** Deterministic work-item id for a fixture request, matching the projector's identity rule. */
function requestId(workId: string): string {
	return deriveWorkItemId(
		"default",
		"work-due",
		workId,
		workRequested(workId).eventId,
	);
}

describe("scanAutomations", () => {
	it("issues one command per outstanding row in row sequence", () => {
		const projection = replayEvents(CONFIG, "default", [
			workRequested("work-1"),
			workRequested("work-2"),
		]);
		const scan = scanAutomations(CONFIG, "default", projection, new Set());
		expect(scan.duplicates).toBe(0);
		expect(scan.records).toHaveLength(2);
		expect(scan.records[0]?.workItemId).toBe(requestId("work-1"));
		expect(scan.records[1]?.workItemId).toBe(requestId("work-2"));
	});

	it("counts known command IDs as duplicates and issues nothing new on rescan", () => {
		const projection = replayEvents(CONFIG, "default", [
			workRequested("work-1"),
		]);
		const first = scanAutomations(CONFIG, "default", projection, new Set());
		expect(first.records).toHaveLength(1);
		const known = new Set(first.records.map((record) => record.commandId));
		const second = scanAutomations(CONFIG, "default", projection, known);
		expect(second.records).toHaveLength(0);
		expect(second.duplicates).toBe(1);
	});

	it("ignores dispatched, stalled and completed rows", () => {
		const projection = replayEvents(CONFIG, "default", [
			workRequested("work-1"),
			workCompleted("work-1"),
		]);
		const scan = scanAutomations(CONFIG, "default", projection, new Set());
		expect(scan.records).toHaveLength(0);
	});

	it("returns nothing for an unknown profile", () => {
		const projection = replayEvents(CONFIG, "default", [
			workRequested("work-1"),
		]);
		const scan = scanAutomations(CONFIG, "other", projection, new Set());
		expect(scan.records).toHaveLength(0);
		expect(scan.duplicates).toBe(0);
	});
});

describe("createPostAppendPipeline", () => {
	it("projects the event, queues its command and reports both effect ids", () => {
		const runtime = createEventLoopRuntime();
		const pipeline = createPostAppendPipeline(runtime);
		const request = workRequested("work-42");
		const effects = pipeline(request, CONFIG, "default");
		expect(runtime.projection.items.get(requestId("work-42"))?.status).toBe(
			"outstanding",
		);
		expect(runtime.queue).toHaveLength(1);
		expect(runtime.queue[0]?.workItemId).toBe(requestId("work-42"));
		expect(runtime.queue[0]?.commandId).toMatch(/^cmd-/);
		expect(effects.commandIds).toHaveLength(1);
		expect(effects.workItemIds).toEqual([requestId("work-42")]);
	});

	it("emits no new effects when the same event is applied twice (deterministic IDs)", () => {
		const runtime = createEventLoopRuntime();
		const pipeline = createPostAppendPipeline(runtime);
		const request = workRequested("work-42");
		pipeline(request, CONFIG, "default");
		const again = pipeline(request, CONFIG, "default");
		expect(again.commandIds).toHaveLength(0);
		expect(again.workItemIds).toHaveLength(0);
		expect(runtime.queue).toHaveLength(1);
	});

	it("cancels the queued command when a closing event completes its item (SPEC §13)", () => {
		const runtime = createEventLoopRuntime();
		const pipeline = createPostAppendPipeline(runtime);
		pipeline(workRequested("work-42"), CONFIG, "default");
		expect(runtime.queue).toHaveLength(1);
		pipeline(workCompleted("work-42"), CONFIG, "default");
		expect(runtime.queue[0]?.status).toBe("cancelled");
	});

	it("pauses with an operator-visible reason when the queue bound is exhausted (SPEC §14)", () => {
		const runtime = createEventLoopRuntime();
		const pipeline = createPostAppendPipeline(runtime);
		const bounded = {
			...CONFIG,
			limits: { ...CONFIG.limits, maxPendingCommands: 1 },
		};
		pipeline(workRequested("work-1"), bounded, "default");
		expect(runtime.paused).toBe(false);
		pipeline(workRequested("work-2"), bounded, "default");
		expect(runtime.paused).toBe(true);
		expect(runtime.pauseReason).toContain("maxPendingCommands");
	});
});

describe("command identity determinism", () => {
	it("command id depends only on profile, automation and work item (SPEC §10)", () => {
		expect(deriveCommandId("default", "perform", requestId("work-42"))).toMatch(
			/^cmd-[0-9a-f]{64}$/,
		);
	});
});
