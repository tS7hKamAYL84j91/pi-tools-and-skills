import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatHiddenCountCue, formatScrollCue } from "../../lib/tui-overflow.js";
import { assertProperty } from "./fast-check.js";

describe("bounded TUI overflow properties", () => {
	it("does not emit a scroll cue when all items are visible", () => {
		assertProperty(fc.property(fc.nat({ max: 100 }), (visibleCount) => {
			expect(formatScrollCue({ visibleCount, totalCount: visibleCount })).toBeUndefined();
			expect(formatScrollCue({ visibleCount, totalCount: 0, canScrollDown: true })).toBeUndefined();
		}));
	});

	it("formats hidden counts with singular and plural units", () => {
		assertProperty(fc.property(fc.integer({ min: 1, max: 100 }), (count) => {
			const cue = formatHiddenCountCue(count, "item");
			expect(cue).toBe(`...+${count} more ${count === 1 ? "item" : "items"}`);
		}));
	});
});
