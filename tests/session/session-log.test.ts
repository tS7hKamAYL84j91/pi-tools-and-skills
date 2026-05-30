import { describe, expect, it, afterEach } from "vitest";
import { readSessionLog, formatSessionLog, type SessionEvent } from "../../lib/session-log.js";
import { writeFileSync, mkdtempSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("session-log", () => {
	let tempDir: string | undefined;

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
			tempDir = undefined;
		}
	});

	function createTempFile(lines: string[]): string {
		tempDir = mkdtempSync(join(tmpdir(), "session-log-test-"));
		chmodSync(tempDir, 0o700);
		const filePath = join(tempDir, "log.jsonl");
		writeFileSync(filePath, lines.join("\n"), "utf-8");
		return filePath;
	}

	describe("readSessionLog", () => {
		it("returns empty array if file does not exist", () => {
			const events = readSessionLog("non-existent.jsonl", 10);
			expect(events).toEqual([]);
		});

		it("skips malformed lines and parses valid ones", () => {
			const filePath = createTempFile([
				`{malformed json`,
				`{"type": "model_change", "model": "test-model"}`,
				`not json at all`
			]);

			const events = readSessionLog(filePath, 10);
			expect(events).toHaveLength(1);
			expect(events[0]?.event).toBe("model_change");
			expect(events[0]).toHaveProperty("model", "test-model");
		});

		it("parses text messages", () => {
			const filePath = createTempFile([
				JSON.stringify({
					ts: 1000,
					message: {
						role: "user",
						content: [{ type: "text", text: "hello world" }]
					}
				})
			]);

			const events = readSessionLog(filePath, 10);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				ts: 1000,
				event: "message",
				role: "user",
				text: "hello world"
			});
		});

		it("parses tool calls", () => {
			const filePath = createTempFile([
				JSON.stringify({
					ts: 2000,
					message: {
						role: "assistant",
						content: [{ type: "toolCall", name: "bash", input: { command: "ls" }, id: "call_123" }]
					}
				})
			]);

			const events = readSessionLog(filePath, 10);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				ts: 2000,
				event: "tool_call",
				tool: "bash",
				args: JSON.stringify({ command: "ls" }),
				id: "call_123"
			});
		});

		it("parses tool results", () => {
			const filePath = createTempFile([
				JSON.stringify({
					ts: 3000,
					message: {
						role: "user",
						content: [{
							type: "toolResult",
							name: "bash",
							content: [{ type: "text", text: "file.txt" }],
							isError: false,
							id: "call_123"
						}]
					}
				})
			]);

			const events = readSessionLog(filePath, 10);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				ts: 3000,
				event: "tool_result",
				tool: "bash",
				summary: "file.txt",
				isError: false,
				id: "call_123"
			});
		});

		it("parses session start", () => {
			const filePath = createTempFile([
				JSON.stringify({
					type: "session",
					timestamp: 4000,
					id: "sess_1",
					cwd: "/tmp/workspace"
				})
			]);

			const events = readSessionLog(filePath, 10);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				ts: 4000,
				event: "session_start",
				id: "sess_1",
				cwd: "/tmp/workspace"
			});
		});

		it("parses message without content array", () => {
			const filePath = createTempFile([
				JSON.stringify({
					ts: 5000,
					message: {
						role: "system"
					}
				})
			]);

			const events = readSessionLog(filePath, 10);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				ts: 5000,
				event: "message",
				role: "system"
			});
		});

		it("limits events to count", () => {
			const filePath = createTempFile([
				`{"type": "model_change", "model": "m1"}`,
				`{"type": "model_change", "model": "m2"}`,
				`{"type": "model_change", "model": "m3"}`
			]);

			const events = readSessionLog(filePath, 2);
			expect(events).toHaveLength(2);
			expect(events[0]).toHaveProperty("model", "m2");
			expect(events[1]).toHaveProperty("model", "m3");
		});
	});

	describe("formatSessionLog", () => {
		it("formats empty events", () => {
			expect(formatSessionLog([])).toBe("(no activity recorded yet)");
		});

		it("formats message events", () => {
			const events: SessionEvent[] = [
				{ ts: new Date("2023-01-01T12:00:00Z").getTime(), event: "message", role: "user", text: "hello" },
				{ ts: new Date("2023-01-01T12:00:01Z").getTime(), event: "message", role: "assistant" }
			];
			const formatted = formatSessionLog(events);
			expect(formatted).toContain("[12:00:00] message role=user text=\"hello\"");
			expect(formatted).toContain("[12:00:01] message role=assistant");
		});

		it("formats tool calls and results", () => {
			const events: SessionEvent[] = [
				{ ts: new Date("2023-01-01T12:00:02Z").getTime(), event: "tool_call", tool: "bash", args: "{}" },
				{ ts: new Date("2023-01-01T12:00:03Z").getTime(), event: "tool_result", tool: "bash", summary: "done" },
				{ ts: new Date("2023-01-01T12:00:04Z").getTime(), event: "tool_result", tool: "bash", error: true, isError: true }
			];
			const formatted = formatSessionLog(events);
			expect(formatted).toContain("[12:00:02] tool_call tool=bash args={}");
			expect(formatted).toContain("[12:00:03] tool_result tool=bash summary=\"done\"");
			expect(formatted).toContain("[12:00:04] tool_result tool=bash error");
		});

		it("formats session and model change", () => {
			const events: SessionEvent[] = [
				{ ts: new Date("2023-01-01T12:00:05Z").getTime(), event: "session_start", cwd: "/home" },
				{ ts: new Date("2023-01-01T12:00:06Z").getTime(), event: "model_change", model: "claude" }
			];
			const formatted = formatSessionLog(events);
			expect(formatted).toContain("[12:00:05] session_start cwd=/home");
			expect(formatted).toContain("[12:00:06] model_change model=claude");
		});
	});
});
