/** Tests for BoundedTaskSet queueing (no drop on sync-turn bursts). */

import { describe, expect, it } from "vitest";

import { BoundedTaskSet } from "../resource-bounds.js";

/** Flush pending microtasks. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("BoundedTaskSet", () => {
	it("processes a synchronous burst beyond the active bound in order", async () => {
		const executed: number[] = [];
		const set = new BoundedTaskSet(2);
		for (let i = 1; i <= 10; i++) {
			const accepted = set.tryRun(() => void executed.push(i), () => {});
			expect(accepted, `task ${i} should be queued, not dropped`).toBe(true);
		}
		await set.closeAndDrain();
		await tick();
		expect(executed).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	});

	it("reports a drop only when active and pending bounds both overflow", async () => {
		let release!: () => void;
		const blocker = new Promise<void>((resolve) => {
			release = resolve;
		});
		const executed: number[] = [];
		const set = new BoundedTaskSet(1, 2);
		expect(set.tryRun(() => blocker, () => {})).toBe(true); // active
		expect(set.tryRun(() => void executed.push(2), () => {})).toBe(true); // queued
		expect(set.tryRun(() => void executed.push(3), () => {})).toBe(true); // queued
		expect(set.tryRun(() => void executed.push(4), () => {})).toBe(false); // overflow
		release();
		await set.closeAndDrain();
		await tick();
		expect(executed).toEqual([2, 3]);
	});

	it("closeAndDrain drains queued tasks and refuses new work", async () => {
		let release!: () => void;
		const blocker = new Promise<void>((resolve) => {
			release = resolve;
		});
		const executed: number[] = [];
		const onError = (error: unknown) => {
			throw error;
		};
		const set = new BoundedTaskSet(1, 8);
		set.tryRun(() => blocker, onError);
		set.tryRun(() => void executed.push(2), onError);
		set.tryRun(() => void executed.push(3), onError);
		release();
		await set.closeAndDrain();
		expect(executed).toEqual([2, 3]);
		expect(set.tryRun(() => {}, onError)).toBe(false);
	});

	it("contains failures without stalling the queue", async () => {
		const errors: unknown[] = [];
		const executed: number[] = [];
		const set = new BoundedTaskSet(1);
		set.tryRun(
			() => {
				throw new Error("boom-1");
			},
			(error) => errors.push(error),
		);
		set.tryRun(() => void executed.push(2), (error) => errors.push(error));
		await set.closeAndDrain();
		expect(executed).toEqual([2]);
		expect(errors).toEqual([new Error("boom-1")]);
	});

	it("open preserves already accepted queued work", async () => {
		let release!: () => void;
		const blocker = new Promise<void>((resolve) => {
			release = resolve;
		});
		const executed: number[] = [];
		const set = new BoundedTaskSet(1, 8);
		set.tryRun(() => blocker, () => {});
		expect(set.tryRun(() => void executed.push(2), () => {})).toBe(true);
		set.open(); // Reopening must not silently discard accepted events.
		release();
		await tick();
		expect(executed).toEqual([2]);
		expect(set.tryRun(() => void executed.push(3), () => {})).toBe(true);
		await set.closeAndDrain();
		expect(executed).toEqual([2, 3]);
	});
});
