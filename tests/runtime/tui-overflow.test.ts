import { describe, expect, it } from "vitest";
import { formatHiddenCountCue, formatScrollCue } from "../../lib/tui-overflow.js";

describe("tui overflow helpers", () => {
	it("formats directional scroll cues", () => {
		expect(formatScrollCue({ visibleCount: 5, totalCount: 12, canScrollDown: true })).toBe(
			"[Showing 5 of 12 - scroll ↓ for more]",
		);
		expect(formatScrollCue({ visibleCount: 5, totalCount: 12, canScrollUp: true })).toBe(
			"[Showing 5 of 12 - scroll ↑ for more]",
		);
		expect(formatScrollCue({ visibleCount: 5, totalCount: 12, canScrollUp: true, canScrollDown: true })).toBe(
			"[Showing 5 of 12 - scroll ↑/↓ for more]",
		);
	});

	it("does not advertise scroll when all content is visible or no scroll direction is available", () => {
		expect(formatScrollCue({ visibleCount: 12, totalCount: 12, canScrollDown: true })).toBeUndefined();
		expect(formatScrollCue({ visibleCount: 5, totalCount: 12 })).toBeUndefined();
	});

	it("formats compact hidden-count cues", () => {
		expect(formatHiddenCountCue(1, "line")).toBe("...+1 more line");
		expect(formatHiddenCountCue(3, "line")).toBe("...+3 more lines");
		expect(formatHiddenCountCue(2, "entry", "entries")).toBe("...+2 more entries");
		expect(formatHiddenCountCue(0, "line")).toBeUndefined();
		expect(formatHiddenCountCue(-1, "line")).toBeUndefined();
	});
});
