import { describe, expect, it } from "vitest";
import { formatSessionLog } from "../lib/session-log.js";

describe("formatSessionLog", () => {
	it("returns a fallback string when no events exist", () => {
		expect(formatSessionLog([])).toBe("(no activity recorded yet)");
	});

	it("formats message events with and without text", () => {
		const result = formatSessionLog([
			{ ts: 1_700_000_000_000, event: "message", role: "user", text: "hello" },
			{ ts: 1_700_000_001_000, event: "message", role: "assistant" }
		]);
		expect(result).toMatch(/\[\d{2}:\d{2}:\d{2}\] message role=user text="hello"/);
		expect(result).toMatch(/\[\d{2}:\d{2}:\d{2}\] message role=assistant(\s*)$/m);
	});

	it("formats tool_call events with and without args", () => {
		const result = formatSessionLog([
			{ ts: 1_700_000_000_000, event: "tool_call", tool: "grep", args: '{"pattern":"test"}' },
			{ ts: 1_700_000_001_000, event: "tool_call", tool: "ping" }
		]);
		expect(result).toMatch(/\[\d{2}:\d{2}:\d{2}\] tool_call tool=grep args=\{"pattern":"test"\}/);
		expect(result).toMatch(/\[\d{2}:\d{2}:\d{2}\] tool_call tool=ping(\s*)$/m);
	});

	it("formats tool_result events with summary and error status", () => {
		const result = formatSessionLog([
			{ ts: 1_700_000_000_000, event: "tool_result", tool: "grep", summary: "found 2 lines" },
			{ ts: 1_700_000_001_000, event: "tool_result", tool: "grep", isError: true },
			{ ts: 1_700_000_002_000, event: "tool_result", tool: "grep", summary: "failed", isError: true }
		]);
		expect(result).toMatch(/\[\d{2}:\d{2}:\d{2}\] tool_result tool=grep summary="found 2 lines"/);
		expect(result).toMatch(/\[\d{2}:\d{2}:\d{2}\] tool_result tool=grep error/);
		expect(result).toMatch(/\[\d{2}:\d{2}:\d{2}\] tool_result tool=grep summary="failed" error/);
	});

	it("formats session_start events", () => {
		const result = formatSessionLog([
			{ ts: 1_700_000_000_000, event: "session_start", cwd: "/home/user/project" },
			{ ts: 1_700_000_001_000, event: "session_start" }
		]);
		expect(result).toMatch(/\[\d{2}:\d{2}:\d{2}\] session_start cwd=\/home\/user\/project/);
		expect(result).toMatch(/\[\d{2}:\d{2}:\d{2}\] session_start(\s*)$/m);
	});

	it("formats model_change events", () => {
		const result = formatSessionLog([
			{ ts: 1_700_000_000_000, event: "model_change", model: "claude-3-opus" }
		]);
		expect(result).toMatch(/\[\d{2}:\d{2}:\d{2}\] model_change model=claude-3-opus/);
	});

	it("properly formats timestamps", () => {
		// Use a specific timestamp so we know the exact time string
		// 2023-11-14T22:13:20.000Z
		const ts = new Date("2023-11-14T22:13:20.000Z").getTime();
		const result = formatSessionLog([
			{ ts, event: "message", role: "user" }
		]);
		expect(result).toBe("[22:13:20] message role=user");
	});

	it("joins multiple events with newlines", () => {
		const ts1 = new Date("2023-11-14T22:13:20.000Z").getTime();
		const ts2 = new Date("2023-11-14T22:14:20.000Z").getTime();
		const result = formatSessionLog([
			{ ts: ts1, event: "message", role: "user", text: "hello" },
			{ ts: ts2, event: "message", role: "assistant", text: "hi" }
		]);
		expect(result).toBe(
			"[22:13:20] message role=user text=\"hello\"\n" +
			"[22:14:20] message role=assistant text=\"hi\""
		);
	});
});
