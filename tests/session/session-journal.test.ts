import { describe, expect, it } from "vitest";
import { renderJournalMarkdown, sessionEntriesToJournal } from "../../lib/session-journal.js";

describe("session journal extraction", () => {
	it("converts synthetic pi session entries into compact markdown", () => {
		const journal = sessionEntriesToJournal([
			{ type: "session", timestamp: 1_700_000_000_000, cwd: "/repo" },
			{ message: { role: "user", timestamp: 1_700_000_001_000, content: [{ type: "text", text: "Ship the patch" }] } },
			{ message: { role: "assistant", timestamp: 1_700_000_002_000, content: [{ type: "toolCall", name: "read", input: { path: "docs/a.md" } }] } },
		]);

		const markdown = renderJournalMarkdown(journal);

		expect(markdown).toContain("# Session journal");
		expect(markdown).toContain("message role=user: Ship the patch");
		expect(markdown).toContain("tool_call role=assistant name=read: path=docs/a.md");
	});

	it("redacts secrets and omits raw/private fields", () => {
		const email = ["human", "example.com"].join("@");
		const tokenValue = ["super", "secret", "value"].join("-");
		const passwordValue = ["hunter", "two"].join("");
		const journal = sessionEntriesToJournal([
			{
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: `email me at ${email} with token=${tokenValue}` },
						{ type: "toolCall", name: "danger", input: { apiKey: `sk_${"x".repeat(16)}`, rawPayload: { private: true }, reasoning: "hidden rationale", visible: "ok" } },
						{ type: "toolResult", name: "dump", content: [{ type: "text", text: `full tool dump with password=${passwordValue}` }] },
					],
				},
			},
		]);

		const markdown = renderJournalMarkdown(journal);

		expect(markdown).toContain("[REDACTED]");
		expect(markdown).toContain("rawPayload=[OMITTED]");
		expect(markdown).toContain("reasoning=[OMITTED]");
		expect(markdown).not.toContain(email);
		expect(markdown).not.toContain(tokenValue);
		expect(markdown).not.toContain(passwordValue);
	});

	it("tolerates missing and unknown fields safely", () => {
		const journal = sessionEntriesToJournal([
			null,
			{ type: "future_event", private: "do not include", rawMessage: "secret" },
			{ message: { role: "user" } },
			{ type: "custom", customType: "pi-teams:run", data: { kind: "run_started", raw: "large payload", prompt: "safe summary" } },
		]);

		const markdown = renderJournalMarkdown(journal);

		expect(journal.omitted).toBe(2);
		expect(markdown).toContain("unknown session event omitted");
		expect(markdown).toContain("message content omitted");
		expect(markdown).toContain("raw=[OMITTED]");
		expect(markdown).not.toContain("do not include");
		expect(markdown).not.toContain("large payload");
	});
});
