/**
 * Tests for structured completion signal format/parse.
 */

import { describe, it, expect } from "vitest";
import {
	formatCompletionSignal,
	parseCompletionSignal,
	type CompletionSignal,
} from "../lib/completion-signal.js";

const DONE_SIGNAL: CompletionSignal = {
	version: 1,
	taskId: "T-260",
	status: "done",
	summary: "Implemented operational workspace state",
	artifacts: ["extensions/pi-panopticon/state.ts", "tests/state.test.ts"],
	duration: "12m",
	tokenUsage: { input: 5000, output: 3000, total: 8000, cost: 0.12 },
};

const BLOCKED_SIGNAL: CompletionSignal = {
	version: 1,
	taskId: "T-246",
	status: "blocked",
	summary: "Waiting for T-245 spec to complete",
	artifacts: [],
	reason: "Upstream dependency T-245 not yet done",
};

describe("formatCompletionSignal", () => {
	it("produces a headline + tagged JSON block", () => {
		const text = formatCompletionSignal(DONE_SIGNAL);
		expect(text).toContain("DONE T-260");
		expect(text).toContain("<completion-signal>");
		expect(text).toContain("</completion-signal>");
		expect(text).toContain('"version":1');
	});

	it("includes blocked status in headline", () => {
		const text = formatCompletionSignal(BLOCKED_SIGNAL);
		expect(text).toContain("BLOCKED T-246");
	});
});

describe("parseCompletionSignal", () => {
	it("round-trips a structured signal", () => {
		const text = formatCompletionSignal(DONE_SIGNAL);
		const parsed = parseCompletionSignal(text);
		expect(parsed).toEqual(DONE_SIGNAL);
	});

	it("round-trips a blocked signal", () => {
		const text = formatCompletionSignal(BLOCKED_SIGNAL);
		const parsed = parseCompletionSignal(text);
		expect(parsed).toEqual(BLOCKED_SIGNAL);
	});

	it("parses legacy informal DONE signals", () => {
		const parsed = parseCompletionSignal("DONE T-135 — agent_status tool registered, 28 tests pass");
		expect(parsed).toBeDefined();
		expect(parsed?.taskId).toBe("T-135");
		expect(parsed?.status).toBe("done");
		expect(parsed?.summary).toBe("agent_status tool registered, 28 tests pass");
		expect(parsed?.artifacts).toEqual([]);
	});

	it("parses legacy informal BLOCKED signals", () => {
		const parsed = parseCompletionSignal("BLOCKED T-136 — need clarification on X");
		expect(parsed).toBeDefined();
		expect(parsed?.taskId).toBe("T-136");
		expect(parsed?.status).toBe("blocked");
		expect(parsed?.reason).toBe("need clarification on X");
	});

	it("returns undefined for non-signal messages", () => {
		expect(parseCompletionSignal("NOTE T-135 - milestone description")).toBeUndefined();
		expect(parseCompletionSignal("just a regular message")).toBeUndefined();
	});

	it("handles malformed JSON in tags gracefully", () => {
		const bad = "DONE T-100 — ok\n<completion-signal>\n{broken json\n</completion-signal>";
		// Falls through to legacy parsing
		const parsed = parseCompletionSignal(bad);
		expect(parsed?.taskId).toBe("T-100");
		expect(parsed?.status).toBe("done");
	});
});
