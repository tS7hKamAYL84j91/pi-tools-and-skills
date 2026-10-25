/**
 * Adversarial acceptance: Maildir metadata length bounds.
 *
 * Former defect (fixed): metadata normalization trimmed and vocabulary-checked
 * values but never bounded their length, so a mailbox writer — the exact threat
 * Maildir has, since external agents get mailbox mounts — could push an
 * unbounded `inReplyTo`/`correlationId` that `message_read` and `fleet_inbox`
 * echoed verbatim. Now MESSAGE_METADATA_MAX_LENGTH applies on both the write and
 * read paths, and over-long values become absent rather than truncated.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMaildirTransport, durableWrite, inboxPaths } from "../../lib/transports/maildir.js";

const roots: string[] = [];
function mailbox(): string {
	const dir = mkdtempSync(join(tmpdir(), "adv-maildir-bounds-"));
	roots.push(dir);
	return join(dir, "inbox");
}
afterEach(() => {
	for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const transport = createMaildirTransport();

describe("maildir metadata bounds", () => {
	it("bounds inReplyTo/correlationId read from a forged envelope", () => {
		const box = mailbox();
		const paths = inboxPaths("peer", box);
		mkdirSync(paths.new, { recursive: true, mode: 0o700 });
		const huge = "r".repeat(200_000);
		writeFileSync(
			join(paths.new, "003.json"),
			JSON.stringify({ id: "u3", from: "bob", text: "t", ts: 3, inReplyTo: huge, correlationId: huge }),
			{ mode: 0o600 },
		);
		const [message] = transport.receive("peer", box);
		// Over-long values are absent, not truncated: a clipped prefix must never
		// masquerade as a valid reply id.
		expect(message).toEqual({ id: "003.json", from: "bob", text: "t", ts: 3 });
	});

	it("bounds metadata on the write path like the send tools do", () => {
		const box = mailbox();
		const result = durableWrite("peer", "alice", "x", { mailboxPath: box, inReplyTo: "r".repeat(1000) });
		expect(result.accepted).toBe(true);
		const paths = inboxPaths("peer", box);
		const [filename] = readdirSync(paths.new);
		const envelope = JSON.parse(readFileSync(join(paths.new, filename as string), "utf8")) as { inReplyTo?: string };
		expect(envelope).not.toHaveProperty("inReplyTo");
	});

	it("keeps the boundary value and drops one character more", () => {
		const box = mailbox();
		durableWrite("peer", "alice", "at-limit", { mailboxPath: box, inReplyTo: "r".repeat(256) });
		durableWrite("peer", "alice", "over-limit", { mailboxPath: box, inReplyTo: "r".repeat(257) });
		// Inbox order is filename order, so select by payload rather than index.
		const received = transport.receive("peer", box);
		const atLimit = received.find((message) => message.text === "at-limit");
		const overLimit = received.find((message) => message.text === "over-limit");
		expect(atLimit?.inReplyTo).toHaveLength(256);
		expect(overLimit).toBeDefined();
		expect(overLimit).not.toHaveProperty("inReplyTo");
	});
});
