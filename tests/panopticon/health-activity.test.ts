/** Tests for panopticon health activity helpers. */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/session-log.js", () => ({
	readSessionLog: vi.fn(() => []),
}));

import { readSessionLog } from "../../lib/session-log.js";
import { agentSocketPath, computeActivityHash, detectApiErrors } from "../../extensions/pi-panopticon/registry/health.js";

const mockReadSessionLog = readSessionLog as ReturnType<typeof vi.fn>;

describe("computeActivityHash", () => {
	it.each([
		["no session file", undefined, [], ""],
		["no events", "/tmp/session.jsonl", [], ""],
	])("returns empty string for %s", (_name, sessionFile, events, expected) => {
		mockReadSessionLog.mockReturnValue(events);
		expect(computeActivityHash(sessionFile)).toBe(expected);
	});

	it("returns stable-looking distinct hashes for different events", () => {
		mockReadSessionLog.mockReturnValueOnce([{ ts: 1000, event: "tool_call", tool: "bash" }]);
		const hash1 = computeActivityHash("/tmp/a.jsonl");
		mockReadSessionLog.mockReturnValueOnce([{ ts: 2000, event: "tool_call", tool: "read" }]);
		const hash2 = computeActivityHash("/tmp/b.jsonl");
		expect(hash1).toMatch(/^[a-f0-9]{64}$/);
		expect(hash1).not.toBe(hash2);
	});
});

describe("detectApiErrors", () => {
	it.each([
		["no session file", undefined, [], false],
		["no tool_result events", "/tmp/s.jsonl", [{ ts: 1000, event: "tool_call", tool: "bash" }], false],
		["successful tool results", "/tmp/s.jsonl", [{ ts: 1000, event: "tool_result", tool: "bash", isError: false }], false],
		["majority errors", "/tmp/s.jsonl", [{ ts: 1000, event: "tool_result", tool: "bash", isError: true }, { ts: 2000, event: "tool_result", tool: "bash", isError: true }, { ts: 3000, event: "tool_result", tool: "read", isError: false }], true],
		["all errors", "/tmp/s.jsonl", [{ ts: 1000, event: "tool_result", tool: "bash", isError: true }], true],
		["minority errors", "/tmp/s.jsonl", [{ ts: 1000, event: "tool_result", tool: "bash", isError: true }, { ts: 2000, event: "tool_result", tool: "bash", isError: false }, { ts: 3000, event: "tool_result", tool: "read", isError: false }], false],
	])("returns %s classification", (_name, sessionFile, events, expected) => {
		mockReadSessionLog.mockReturnValue(events);
		expect(detectApiErrors(sessionFile)).toBe(expected);
	});
});

describe("agentSocketPath", () => {
	it("returns the conventional socket path", () => {
		const path = agentSocketPath("12345-abc");
		expect(path).toContain("12345-abc.sock");
		expect(path).toContain(".pi/agents");
	});
});
