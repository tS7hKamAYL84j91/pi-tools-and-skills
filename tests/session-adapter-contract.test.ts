import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderJournalMarkdown, sessionEntriesToJournal } from "../lib/session-journal.js";
import { readSessionLog } from "../lib/session-log.js";
import { spoolSessionEntries } from "../lib/session-spool.js";

describe("internal session adapter contract", () => {
	it("preserves redacted summaries across journal and Panopticon-compatible spool output", async () => {
		const registryDir = mkdtempSync(join(tmpdir(), "session-adapter-contract-"));
		const email = ["operator", "example.test"].join("@");
		const entries = [
			{ message: { role: "user", timestamp: 1_700_000_001_000, content: [{ type: "text", text: `contact ${email} token=${["local", "secret"].join("-")}` }] } },
			{ message: { role: "assistant", timestamp: 1_700_000_002_000, content: [{ type: "toolCall", name: "read", input: { path: "docs/report.md", rawPayload: "private" } }] } },
		];

		const journal = sessionEntriesToJournal(entries, "Contract");
		const markdown = renderJournalMarkdown(journal);
		const spooled = await spoolSessionEntries({ enabled: true, registryDir, agentId: "contract", name: "Contract", cwd: "/repo", entries });
		const activity = readSessionLog(spooled.sessionFile ?? "", 10);
		const sessionText = readFileSync(spooled.sessionFile ?? "", "utf8");

		expect(markdown).toContain("[REDACTED]");
		expect(markdown).toContain("rawPayload=[OMITTED]");
		expect(sessionText).toContain("[REDACTED]");
		expect(sessionText).toContain("rawPayload=[OMITTED]");
		expect(sessionText).not.toContain(email);
		expect(activity).toEqual([
			expect.objectContaining({ event: "message", role: "user" }),
			expect.objectContaining({ event: "tool_call", tool: "read" }),
		]);
	});

	it("keeps bounded output and claim-check metadata stable internally", async () => {
		const registryDir = mkdtempSync(join(tmpdir(), "session-adapter-bounds-"));
		const entries = [
			{ type: "custom", customType: "claim-check", data: { artifactUri: "session://artifact/1", summary: "kept", raw: "omit" } },
			{ message: { role: "user", content: [{ type: "text", text: "x".repeat(1_000) }] } },
		];

		const journal = sessionEntriesToJournal(entries, "Bounds");
		const spooled = await spoolSessionEntries({ enabled: true, registryDir, agentId: "bounds", name: "Bounds", cwd: "/repo", entries, maxEvents: 1 });
		const sessionText = readFileSync(spooled.sessionFile ?? "", "utf8");

		expect(journal.events[0]).toMatchObject({ type: "custom", name: "claim-check", summary: expect.stringContaining("artifactUri=session://artifact/1") });
		expect(journal.events[0]?.summary).toContain("raw=[OMITTED]");
		expect(journal.events[1]?.summary.length).toBeLessThanOrEqual(241);
		expect(spooled.eventsWritten).toBe(1);
		expect(spooled.omitted).toBe(1);
		expect(sessionText).not.toContain("artifactUri=session://artifact/1");
		expect(sessionText).toContain("x".repeat(120));
	});
});
