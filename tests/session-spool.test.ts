import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSessionLog } from "../lib/session-log.js";
import { spoolSessionEntries } from "../lib/session-spool.js";

describe("session log spooling", () => {
	it("is opt-in and writes nothing when disabled", async () => {
		const registryDir = mkdtempSync(join(tmpdir(), "session-spool-disabled-"));

		const result = await spoolSessionEntries({ enabled: false, registryDir, agentId: "claude-1", name: "Claude 1", cwd: "/repo", entries: [{ message: { role: "user", content: [{ type: "text", text: "hello" }] } }] });

		expect(result).toEqual({ spooled: false, agentId: "claude-1", eventsWritten: 0, omitted: 0 });
	});

	it("writes Panopticon-compatible registry and session JSONL fixtures", async () => {
		const registryDir = mkdtempSync(join(tmpdir(), "session-spool-"));

		const result = await spoolSessionEntries({
			enabled: true,
			registryDir,
			agentId: "claude-code-demo",
			name: "Claude Code Demo",
			cwd: "/repo",
			now: 1_700_000_000_000,
			entries: [
				{ message: { role: "user", timestamp: 1_700_000_001_000, content: [{ type: "text", text: "review safe fixture" }] } },
				{ message: { role: "assistant", timestamp: 1_700_000_002_000, content: [{ type: "toolCall", name: "read", input: { path: "docs/report.md" } }] } },
			],
		});

		expect(result.spooled).toBe(true);
		const record = JSON.parse(readFileSync(result.registryPath ?? "", "utf8")) as { name?: string; sessionFile?: string; model?: string };
		expect(record).toMatchObject({ name: "Claude-Code-Demo", model: "claude-code/session-spool", sessionFile: result.sessionFile });
		expect(readSessionLog(result.sessionFile ?? "", 10)).toEqual([
			expect.objectContaining({ event: "message", role: "user", text: "message: review safe fixture" }),
			expect.objectContaining({ event: "tool_call", tool: "read" }),
		]);
	});

	it("applies allow-list, redaction, retention, and missing-field tolerance", async () => {
		const registryDir = mkdtempSync(join(tmpdir(), "session-spool-redact-"));
		const email = ["person", "example.test"].join("@");
		const tokenValue = ["very", "secret", "token"].join("-");

		const result = await spoolSessionEntries({
			enabled: true,
			registryDir,
			agentId: "unsafe/id",
			name: "Unsafe Claude",
			cwd: "/repo",
			allowedEventTypes: ["message", "custom"],
			maxEvents: 3,
			entries: [
				null,
				{ type: "future_event", rawPayload: "private" },
				{ message: { role: "user", content: [{ type: "text", text: `contact ${email} token=${tokenValue}` }] } },
				{ message: { role: "assistant", content: [{ type: "toolCall", name: "write", input: { raw: "do not spool", visible: "ok" } }] } },
				{ type: "custom", customType: "bridge", data: { reasoning: "hidden", summary: "kept" } },
				{ message: { role: "assistant" } },
			],
		});

		const sessionText = readFileSync(result.sessionFile ?? "", "utf8");
		expect(result.agentId).toBe("unsafe-id");
		expect(result.eventsWritten).toBe(3);
		expect(result.omitted).toBeGreaterThanOrEqual(3);
		expect(sessionText).toContain("[REDACTED]");
		expect(sessionText).toContain("reasoning=[OMITTED]");
		expect(sessionText).not.toContain(email);
		expect(sessionText).not.toContain(tokenValue);
		expect(sessionText).not.toContain("do not spool");
		expect(readSessionLog(result.sessionFile ?? "", 10)).toHaveLength(3);
	});
});
