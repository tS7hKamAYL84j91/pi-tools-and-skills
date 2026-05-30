import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	normalizeTaskLifecycleState,
	persistedTaskColumn,
	planTaskLifecycleTransition,
	TASK_LIFECYCLE_EVENTS,
	TASK_LIFECYCLE_STATES,
	type TaskLifecycleContext,
	type TaskLifecycleEvent,
} from "../../extensions/pi-kanban/lifecycle.js";

function apply(events: Array<{ event: TaskLifecycleEvent; to?: string }>): TaskLifecycleContext {
	let context: TaskLifecycleContext = {};
	for (const event of events) {
		const result = planTaskLifecycleTransition(context, event);
		expect(result.ok, `${event.event} ${event.to ?? ""}: ${result.reason ?? "denied"}`).toBe(true);
		context = { state: result.state, deleted: result.deleted, claimed: result.claimed };
	}
	return context;
}

describe("pi-kanban task lifecycle model", () => {
	it("keeps the lifecycle helper pure and detached from runtime board tools", () => {
		const source = readFileSync(join(process.cwd(), "extensions", "pi-kanban", "lifecycle.ts"), "utf8");
		expect(source).not.toContain("./board.js");
		expect(source).not.toContain("registerTool");
		expect(source).not.toContain("logAppend");
	});

	it("exports the canonical state and event vocabulary", () => {
		expect(TASK_LIFECYCLE_STATES).toEqual(["backlog", "todo", "in_progress", "blocked", "done"]);
		expect(TASK_LIFECYCLE_EVENTS).toEqual([
			"CREATE",
			"MOVE",
			"CLAIM",
			"UNCLAIM",
			"EXPIRE",
			"BLOCK",
			"UNBLOCK",
			"COMPLETE",
			"NOTE",
			"EDIT",
			"DELETE",
			"SNAPSHOT",
			"COMPACT",
		]);
		expect(normalizeTaskLifecycleState("in-progress")).toBe("in_progress");
		expect(persistedTaskColumn("in_progress")).toBe("in-progress");
	});

	it("models the current create, ready, claim, block, unblock, and complete flow", () => {
		const blocked = apply([
			{ event: "CREATE" },
			{ event: "MOVE", to: "todo" },
			{ event: "CLAIM" },
			{ event: "BLOCK" },
		]);
		expect(blocked).toEqual({ state: "blocked", deleted: false, claimed: false });

		const completed = apply([
			{ event: "CREATE" },
			{ event: "MOVE", to: "todo" },
			{ event: "CLAIM" },
			{ event: "BLOCK" },
			{ event: "UNBLOCK" },
			{ event: "CLAIM" },
			{ event: "COMPLETE" },
		]);
		expect(completed).toEqual({ state: "done", deleted: false, claimed: false });
	});

	it("preserves current MOVE-after-semantic-event compatibility ordering", () => {
		const claimed = apply([
			{ event: "CREATE" },
			{ event: "MOVE", to: "todo" },
			{ event: "CLAIM" },
		]);
		expect(planTaskLifecycleTransition(claimed, { event: "MOVE", to: "in-progress" })).toMatchObject({
			ok: true,
			effect: "compatibility_noop",
			state: "in_progress",
		});

		const blocked = planTaskLifecycleTransition(claimed, { event: "BLOCK" });
		expect(planTaskLifecycleTransition(blocked, { event: "MOVE", to: "blocked" })).toMatchObject({
			ok: true,
			effect: "compatibility_noop",
			state: "blocked",
		});

		const completed = planTaskLifecycleTransition(claimed, { event: "COMPLETE" });
		expect(planTaskLifecycleTransition(completed, { event: "MOVE", to: "done" })).toMatchObject({
			ok: true,
			effect: "compatibility_noop",
			state: "done",
		});
	});

	it("denies guarded transitions without changing runtime behavior", () => {
		expect(planTaskLifecycleTransition({ state: "backlog" }, { event: "CLAIM" })).toMatchObject({ ok: false, effect: "denied" });
		expect(planTaskLifecycleTransition({ state: "blocked" }, { event: "CLAIM" })).toMatchObject({ ok: false, effect: "denied" });
		expect(planTaskLifecycleTransition({ state: "done" }, { event: "MOVE", to: "todo" })).toMatchObject({ ok: false, effect: "denied" });
		expect(planTaskLifecycleTransition({ state: "in_progress" }, { event: "MOVE", to: "backlog" })).toMatchObject({ ok: false, effect: "denied" });
		expect(planTaskLifecycleTransition({ state: "blocked" }, { event: "EDIT" })).toMatchObject({ ok: false, effect: "denied" });
	});

	it("keeps deleted as a side flag instead of a normal state", () => {
		expect(planTaskLifecycleTransition({ state: "todo" }, { event: "DELETE" })).toMatchObject({
			ok: true,
			effect: "deleted",
			state: "todo",
			deleted: true,
		});
		expect(planTaskLifecycleTransition({ state: "in_progress" }, { event: "DELETE" })).toMatchObject({ ok: false, reason: expect.stringContaining("DELETE") });
		expect(planTaskLifecycleTransition({ state: "blocked" }, { event: "DELETE" })).toMatchObject({ ok: false, reason: expect.stringContaining("DELETE") });
		expect(normalizeTaskLifecycleState("deleted")).toBeUndefined();
	});

	it("treats guard results as non-lifecycle outcomes unless events append", () => {
		const context = { state: "todo" as const, deleted: false, claimed: false };
		const afterSnapshot = planTaskLifecycleTransition(context, { event: "SNAPSHOT" });
		const afterNote = planTaskLifecycleTransition(context, { event: "NOTE" });

		expect(afterSnapshot).toMatchObject({ ok: true, effect: "maintenance", state: "todo" });
		expect(afterNote).toMatchObject({ ok: true, effect: "noted", state: "todo" });
		expect(context).toEqual({ state: "todo", deleted: false, claimed: false });
	});
});
