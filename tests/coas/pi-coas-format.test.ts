import { describe, expect, it } from "vitest";
import { commandSummary, widgetLines } from "../../extensions/pi-coas/format.js";

describe("widgetLines", () => {
	it("keeps non-empty lines within the widget limit", () => {
		expect(widgetLines("line 1\n\nline 2\n", 3)).toEqual(["line 1", "line 2"]);
	});

	it("adds an ellipsis when widget output is truncated", () => {
		expect(widgetLines("one\ntwo\nthree\nfour", 3)).toEqual(["one", "two", "..."]);
	});

	it("returns no lines for empty widget text", () => {
		expect(widgetLines("")).toEqual([]);
	});
});

describe("commandSummary", () => {
	it("formats successful command output", () => {
		const summary = commandSummary("coas-status", { code: 0, stdout: "ok\n", stderr: "" });
		expect(summary).toBe("coas-status exit=0\n\nok");
	});

	it("formats failed command stderr", () => {
		const summary = commandSummary("coas-doctor", { code: 1, stdout: "", stderr: "bad\n" });
		expect(summary).toBe("coas-doctor exit=1\n\nbad");
	});

	it("truncates long command output", () => {
		const summary = commandSummary("coas-doctor", { code: 0, stdout: `${"line\n".repeat(2001)}`, stderr: "" });
		expect(summary).toContain("[Output truncated: 2001 line(s)");
	});
});
