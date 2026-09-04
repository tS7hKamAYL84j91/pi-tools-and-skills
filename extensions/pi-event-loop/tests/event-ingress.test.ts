/** Tests for the event_loop_emit ingress decision logic and tool (SPEC §7, AC-2, AC-3). */

import { describe, expect, it } from "vitest";
import { CONFIG } from "../../../tests/fixtures/pi-event-loop.js";
import { type EmissionContext, evaluateEmission } from "../event-ingress.js";
import type { CommandRecord, TodoItem } from "../types.js";

const WORK_ITEM: TodoItem = {
	workItemId: "item-1",
	viewId: "work-due",
	key: "work-42",
	openedByEventId: "evt-open",
	sourcePayload: { workId: "work-42" },
	status: "dispatched",
	commandId: "cmd-1",
};

const ACTIVE_COMMAND: CommandRecord = {
	commandId: "cmd-1",
	type: "perform-work",
	automationId: "perform",
	workItemId: "item-1",
	viewId: "work-due",
	correlationId: "work-42",
	causedBy: "evt-open",
	message: "Perform the work.",
	expectedEvents: ["work.completed", "work.failed"],
	workItem: { workId: "work-42" },
	status: "delivered",
};

function context(overrides: Partial<EmissionContext> = {}): EmissionContext {
	return {
		config: CONFIG,
		profileName: "default",
		source: "agent",
		activeCommand: undefined,
		activeWorkItem: undefined,
		knownEventIds: new Set<string>(),
		now: () => "2026-09-04T15:00:00Z",
		...overrides,
	};
}

describe("emission decision logic", () => {
	it("accepts an allowWithoutCommand event when no command is active", () => {
		const decision = evaluateEmission(context(), {
			event: "progress.note",
			dedupeKey: "n1",
			payload: {},
		});
		expect(decision.ok).toBe(true);
		if (decision.ok) {
			expect(decision.duplicate).toBe(false);
			expect(decision.event.eventId).toMatch(/^evt-/);
			expect(decision.event.source).toBe("agent");
			expect(decision.event.commandId).toBeUndefined();
		}
	});

	it("rejects an agent event without allowWithoutCommand when no command is active", () => {
		const decision = evaluateEmission(context(), {
			event: "work.completed",
			dedupeKey: "c1",
			payload: { workId: "work-42", resultPath: "r" },
		});
		expect(decision.ok).toBe(false);
		if (!decision.ok) {
			expect(decision.reason).toContain("active command turn");
		}
	});

	it("rejects events that do not allow agent emission", () => {
		const decision = evaluateEmission(context(), {
			event: "work.requested",
			dedupeKey: "r1",
			payload: { workId: "w" },
		});
		expect(decision.ok).toBe(false);
		if (!decision.ok) {
			expect(decision.reason).toContain("does not allow agent emission");
		}
	});

	it("allows operator emissions of non-agent events (normal path)", () => {
		const decision = evaluateEmission(context({ source: "operator" }), {
			event: "work.requested",
			dedupeKey: "op1",
			payload: { workId: "w" },
		});
		expect(decision.ok).toBe(true);
	});

	it("rejects events outside the active command's expected events", () => {
		const active = context({
			activeCommand: ACTIVE_COMMAND,
			activeWorkItem: WORK_ITEM,
		});
		const decision = evaluateEmission(active, {
			event: "progress.note",
			dedupeKey: "n2",
			payload: {},
		});
		expect(decision.ok).toBe(false);
		if (!decision.ok) {
			expect(decision.reason).toContain("not one of the active command");
		}
	});

	it("accepts an expected event during a command turn and attaches causation metadata", () => {
		const active = context({
			activeCommand: ACTIVE_COMMAND,
			activeWorkItem: WORK_ITEM,
		});
		const decision = evaluateEmission(active, {
			event: "work.completed",
			dedupeKey: "work-42-done",
			payload: { workId: "work-42", resultPath: "results/42.json" },
		});
		expect(decision.ok).toBe(true);
		if (decision.ok) {
			expect(decision.event.commandId).toBe("cmd-1");
			expect(decision.event.workItemId).toBe("item-1");
			expect(decision.event.correlationId).toBe("work-42");
			expect(decision.event.causationId).toBe("cmd-1");
		}
	});

	it("rejects an expected event whose correlation key points at a different item", () => {
		const active = context({
			activeCommand: ACTIVE_COMMAND,
			activeWorkItem: WORK_ITEM,
		});
		const decision = evaluateEmission(active, {
			event: "work.completed",
			dedupeKey: "other",
			payload: { workId: "work-99", resultPath: "r" },
		});
		expect(decision.ok).toBe(false);
		if (!decision.ok) {
			expect(decision.reason).toContain('active item is "work-42"');
		}
	});

	it("rejects payloads missing required keys", () => {
		const decision = evaluateEmission(context({ source: "operator" }), {
			event: "work.completed",
			dedupeKey: "c2",
			payload: { workId: "w" },
		});
		expect(decision.ok).toBe(false);
		if (!decision.ok) {
			expect(decision.reason).toContain(
				'missing required payload key "resultPath"',
			);
		}
	});

	it("rejects payloads exceeding maxPayloadBytes", () => {
		const decision = evaluateEmission(context({ source: "operator" }), {
			event: "work.completed",
			dedupeKey: "big",
			payload: { workId: "w", resultPath: "x".repeat(2048) },
		});
		expect(decision.ok).toBe(false);
		if (!decision.ok) {
			expect(decision.reason).toContain("exceeds maxPayloadBytes 1024");
		}
	});

	it("rejects unknown events and empty dedupe keys", () => {
		expect(
			evaluateEmission(context({ source: "operator" }), {
				event: "nope.event",
				dedupeKey: "d",
				payload: {},
			}).ok,
		).toBe(false);
		expect(
			evaluateEmission(context({ source: "operator" }), {
				event: "work.completed",
				dedupeKey: "",
				payload: { workId: "w", resultPath: "r" },
			}).ok,
		).toBe(false);
	});

	it("flags duplicate dedupe keys without producing a new event", () => {
		// evt-first must equal deriveEventId("default", "work.completed", "dup") — compute through the decision itself.
		const first = evaluateEmission(context({ source: "operator" }), {
			event: "work.completed",
			dedupeKey: "dup",
			payload: { workId: "w", resultPath: "r" },
		});
		expect(first.ok).toBe(true);
		if (!first.ok) {
			return;
		}
		const duplicate = evaluateEmission(
			context({
				source: "operator",
				knownEventIds: new Set<string>([first.event.eventId]),
			}),
			{
				event: "work.completed",
				dedupeKey: "dup",
				payload: { workId: "w", resultPath: "r" },
			},
		);
		expect(duplicate.ok).toBe(true);
		if (duplicate.ok) {
			expect(duplicate.duplicate).toBe(true);
			expect(duplicate.event.eventId).toBe(first.event.eventId);
		}
	});

	it("produces identical event ids for identical profile+type+dedupeKey", () => {
		const a = evaluateEmission(context({ source: "operator" }), {
			event: "work.completed",
			dedupeKey: "k",
			payload: { workId: "w", resultPath: "r" },
		});
		const b = evaluateEmission(context({ source: "operator" }), {
			event: "work.completed",
			dedupeKey: "k",
			payload: { workId: "w", resultPath: "r" },
		});
		expect(a.ok && b.ok && a.event.eventId === b.event.eventId).toBe(true);
	});
});
