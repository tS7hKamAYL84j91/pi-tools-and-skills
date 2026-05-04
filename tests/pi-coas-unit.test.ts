import { describe, expect, it } from "vitest";
import { shortCommandSummary, truncateText } from "../extensions/pi-coas/format.js";
import { assertSafeId, formatEnv, parseEnv, pathInside, slugify, workspaceIdFromRoom } from "../extensions/pi-coas/store.js";
import { validateCronExpr, formatScheduleList } from "../extensions/pi-coas/schedules.js";
import { ok, fail } from "../lib/tool-result.js";
import type { CommandResult, ScheduleEntry } from "../extensions/pi-coas/types.js";

describe("store", () => {
	describe("slugify", () => {
		it("lowercases and replaces separators", () => {
			expect(slugify("My Workspace")).toBe("my-workspace");
		});

		it("collapses multiple separators", () => {
			expect(slugify("a---b")).toBe("a-b");
		});

		it("trims leading/trailing separators", () => {
			expect(slugify("-hello-")).toBe("hello");
		});

		it("returns fallback for empty string", () => {
			expect(slugify("", "fallback")).toBe("fallback");
		});

		it("returns fallback for all-special input", () => {
			expect(slugify("---", "fallback")).toBe("fallback");
		});
	});

	describe("workspaceIdFromRoom", () => {
		it("prefixes slugified room", () => {
			expect(workspaceIdFromRoom("general")).toBe("room-general");
		});
	});

	describe("assertSafeId", () => {
		it("accepts valid ids", () => {
			expect(() => assertSafeId("test", "abc123")).not.toThrow();
		});

		it("rejects ids with spaces", () => {
			expect(() => assertSafeId("test", "abc 123")).toThrow(/Invalid/);
		});

		it("rejects ids with ..", () => {
			expect(() => assertSafeId("test", "a..b")).toThrow(/Invalid/);
		});
	});

	describe("pathInside", () => {
		it("returns true for child path", () => {
			expect(pathInside("/root", "/root/child")).toBe(true);
		});

		it("returns true for exact match", () => {
			expect(pathInside("/root", "/root")).toBe(true);
		});

		it("returns false for sibling", () => {
			expect(pathInside("/root", "/other")).toBe(false);
		});

		it("returns false for escape attempt", () => {
			expect(pathInside("/root", "/root/../other")).toBe(false);
		});
	});

	describe("parseEnv / formatEnv", () => {
		it("round-trips simple values", () => {
			const values = { KEY: "value", NUM: "42" };
			expect(parseEnv(formatEnv(values))).toEqual(values);
		});

		it("ignores comments and blank lines", () => {
			const content = "# comment\n\nKEY=val\n\n";
			expect(parseEnv(content)).toEqual({ KEY: "val" });
		});

		it("unquotes single-quoted values", () => {
			expect(parseEnv("KEY='hello world'")).toEqual({ KEY: "hello world" });
		});

		it("unquotes double-quoted values", () => {
			expect(parseEnv('KEY="hello world"')).toEqual({ KEY: "hello world" });
		});

		it("skips lines without equals", () => {
			expect(parseEnv("NOEQUALS\nKEY=val")).toEqual({ KEY: "val" });
		});
	});
});

describe("format", () => {
	describe("shortCommandSummary", () => {
		it("shows exit code and limited lines", () => {
			const result: CommandResult = { code: 0, stdout: ["a", "b", "c", "d", "e"].join("\n"), stderr: "" };
			const summary = shortCommandSummary("test", result, 3);
			expect(summary).toBe("test exit=0\na\nb\nc\n...");
		});

		it("does not add ellipsis when output fits", () => {
			const result: CommandResult = { code: 1, stdout: "a\nb", stderr: "" };
			const summary = shortCommandSummary("test", result, 4);
			expect(summary).toBe("test exit=1\na\nb");
		});
	});

	describe("truncateText", () => {
		it("reports lines limit hit", () => {
			const long = `${"line\n".repeat(2001)}`;
			const result = truncateText(long);
			expect(result.truncated).toBe(true);
			expect(result.limitHit).toBe("lines");
		});

		it("reports bytes limit hit", () => {
			const huge = "x".repeat(60 * 1024);
			const result = truncateText(huge);
			expect(result.truncated).toBe(true);
			expect(result.limitHit).toBe("bytes");
		});

		it("returns no limit for short text", () => {
			const result = truncateText("hello\nworld");
			expect(result.truncated).toBe(false);
			expect(result.limitHit).toBeUndefined();
		});
	});
});

describe("schedules", () => {
	describe("validateCronExpr", () => {
		it("accepts valid five-field cron", () => {
			expect(() => validateCronExpr("0 9 * * 1")).not.toThrow();
		});

		it("rejects fewer than five fields", () => {
			expect(() => validateCronExpr("0 9 * *")).toThrow(/five fields/);
		});

		it("rejects empty fields", () => {
			expect(() => validateCronExpr("0 9  * *")).toThrow(/five fields/);
		});

		it("rejects expressions with more than five fields", () => {
			expect(() => validateCronExpr("0 9 * * 1 extra")).toThrow(/five fields/);
		});
	});

	describe("formatScheduleList", () => {
		it("formats schedule table with header", () => {
			const entry: ScheduleEntry = {
				taskId: "daily-check",
				taskName: "Daily Check",
				roomId: "general",
				workspaceId: "room-general",
				cronExpr: "0 9 * * 1",
				enabled: true,
				promptFile: "/tmp/daily-check.prompt",
			};
			const result = formatScheduleList([entry]);
			expect(result).toContain("TASK");
			expect(result).toContain("daily-check");
			expect(result).toContain("Daily Check");
		});

		it("formats empty list", () => {
			expect(formatScheduleList([])).toContain("TASK");
		});
	});
});

describe("tool-result error paths", () => {
	it("ok result is not an error", () => {
		const result = ok("success", { code: 0 });
		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toBe("success");
	});

	it("fail result is an error", () => {
		const result = fail("No workspace selected and cwd is not a CoAS workspace");
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("No workspace selected");
	});

	it("fail result includes details", () => {
		const result = fail("Schedule already exists: daily-check", { taskId: "daily-check" });
		expect(result.isError).toBe(true);
		expect(result.details).toEqual({ taskId: "daily-check" });
	});

	it("fail result for empty context update", () => {
		const result = fail("Context update text must not be empty", { textLength: 0 });
		expect(result.isError).toBe(true);
		expect(result.details).toEqual({ textLength: 0 });
	});

	it("assertSafeId error is catchable", () => {
		try {
			assertSafeId("workspace id", "../etc/passwd");
			expect.unreachable("should have thrown");
		} catch (error) {
			const result = fail((error as Error).message, { id: "../etc/passwd" });
			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain("Invalid workspace id");
		}
	});
});