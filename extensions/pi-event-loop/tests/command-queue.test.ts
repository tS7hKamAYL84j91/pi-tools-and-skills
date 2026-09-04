/** Tests for the command queue: identity, dedupe, bounds, cancellation, FIFO (SPEC §10, §11, §13). */

import { describe, expect, it } from "vitest";

import {
	buildCommandRecord,
	cancelQueuedForCompletedItems,
	enqueueCommand,
	takeNextCommand,
} from "../command-queue.js";
import {
	type CommandRecord,
	deriveCommandId,
	type ProfileConfig,
} from "../types.js";
import { CONFIG, PROFILE, workItem } from "../../../tests/fixtures/pi-event-loop.js";

describe("buildCommandRecord", () => {
	it("derives the stable command ID and copies the item contract", () => {
		const record = buildCommandRecord(
			"default",
			PROFILE,
			PROFILE.automations[0]!,
			workItem("outstanding"),
		);
		expect(record).toBeDefined();
		expect(record?.commandId).toBe(
			deriveCommandId("default", "perform", "item-work-42"),
		);
		expect(record?.type).toBe("perform-work");
		expect(record?.automationId).toBe("perform");
		expect(record?.viewId).toBe("work-due");
		expect(record?.correlationId).toBe("work-42");
		expect(record?.causedBy).toBe("evt-open");
		expect(record?.message).toBe("Perform the work.");
		expect(record?.expectedEvents).toEqual(["work.completed", "work.failed"]);
		expect(record?.workItem).toEqual({ workId: "work-42" });
		expect(record?.status).toBe("queued");
	});

	it("is deterministic for the same automation and item", () => {
		const first = buildCommandRecord(
			"default",
			PROFILE,
			PROFILE.automations[0]!,
			workItem("outstanding"),
		);
		const second = buildCommandRecord(
			"default",
			PROFILE,
			PROFILE.automations[0]!,
			workItem("outstanding"),
		);
		expect(first?.commandId).toBe(second?.commandId);
	});

	it("returns undefined when the automation issues an unknown command", () => {
		const broken: ProfileConfig = {
			...PROFILE,
			automations: [{ id: "perform", view: "work-due", issue: "missing" }],
		};
		const record = buildCommandRecord(
			"default",
			broken,
			broken.automations[0]!,
			workItem("outstanding"),
		);
		expect(record).toBeUndefined();
	});
});

describe("enqueueCommand", () => {
	it("appends new commands and reports duplicates without changing the queue", () => {
		const record = buildCommandRecord(
			"default",
			PROFILE,
			PROFILE.automations[0]!,
			workItem("outstanding"),
		) as CommandRecord;
		const first = enqueueCommand([], record, CONFIG.limits);
		expect(first).toEqual({
			ok: true,
			queue: [record],
			record,
			duplicate: false,
		});
		const second = enqueueCommand([record], record, CONFIG.limits);
		if (!second.ok) {
			throw new Error("expected duplicate enqueue to succeed");
		}
		expect(second.duplicate).toBe(true);
		expect(second.queue).toHaveLength(1);
	});

	it("rejects enqueueing beyond maxPendingCommands with a reason", () => {
		const limits = { ...CONFIG.limits, maxPendingCommands: 1 };
		const a = buildCommandRecord(
			"default",
			PROFILE,
			PROFILE.automations[0]!,
			workItem("outstanding", "work-1"),
		) as CommandRecord;
		const b = buildCommandRecord(
			"default",
			PROFILE,
			PROFILE.automations[0]!,
			workItem("outstanding", "work-2"),
		) as CommandRecord;
		const first = enqueueCommand([], a, limits);
		expect(first.ok).toBe(true);
		const second = enqueueCommand(first.queue, b, limits);
		expect(second.ok).toBe(false);
		if (!second.ok) {
			expect(second.reason).toContain("maxPendingCommands");
			expect(second.queue).toEqual(first.queue);
		}
	});
});

describe("cancelQueuedForCompletedItems", () => {
	it("cancels only queued commands whose work item is completed", () => {
		const queued = buildCommandRecord(
			"default",
			PROFILE,
			PROFILE.automations[0]!,
			workItem("outstanding"),
		) as CommandRecord;
		const active: CommandRecord = {
			...queued,
			commandId: deriveCommandId("default", "perform", "item-other"),
			workItemId: "item-other",
			status: "active",
		};
		const projection = {
			items: new Map([
				["item-work-42", workItem("completed")],
				["item-other", workItem("outstanding", "other")],
			]),
			order: ["item-work-42", "item-other"],
		};
		const result = cancelQueuedForCompletedItems([queued, active], projection);
		expect(result.cancelledIds).toEqual([queued.commandId]);
		expect(result.queue[0]?.status).toBe("cancelled");
		expect(result.queue[1]?.status).toBe("active");
	});
});

describe("takeNextCommand", () => {
	it("takes the head queued command FIFO and marks it active", () => {
		const a = buildCommandRecord(
			"default",
			PROFILE,
			PROFILE.automations[0]!,
			workItem("outstanding", "work-1"),
		) as CommandRecord;
		const b = buildCommandRecord(
			"default",
			PROFILE,
			PROFILE.automations[0]!,
			workItem("outstanding", "work-2"),
		) as CommandRecord;
		const taken = takeNextCommand([a, b], undefined);
		expect(taken?.command.commandId).toBe(a.commandId);
		expect(taken?.command.status).toBe("active");
		expect(taken?.queue).toEqual([b]);
	});

	it("refuses to take when a command is already active or the queue is empty", () => {
		const a = buildCommandRecord(
			"default",
			PROFILE,
			PROFILE.automations[0]!,
			workItem("outstanding"),
		) as CommandRecord;
		expect(takeNextCommand([a], a)).toBeUndefined();
		expect(takeNextCommand([], undefined)).toBeUndefined();
	});
});
