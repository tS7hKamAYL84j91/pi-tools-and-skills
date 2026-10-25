/**
 * Adversarial acceptance: Maildir envelope metadata, real filesystem (no mocks).
 *
 * Criteria source: lib/transports/README.md ("Maildir envelope") and CHANGELOG
 * 1.2.0. These try to falsify the documented claims rather than re-assert the
 * implementation's own tests.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMaildirTransport, durableWrite, inboxPaths } from "../../lib/transports/maildir.js";

const roots: string[] = [];

function mailbox(): string {
	const dir = mkdtempSync(join(tmpdir(), "adv-maildir-"));
	roots.push(dir);
	return join(dir, "inbox");
}

function dropRaw(box: string, filename: string, envelope: unknown): void {
	const paths = inboxPaths("peer", box);
	mkdirSync(paths.new, { recursive: true, mode: 0o700 });
	writeFileSync(join(paths.new, filename), JSON.stringify(envelope), { mode: 0o600 });
}

afterEach(() => {
	for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const transport = createMaildirTransport();

describe("maildir metadata acceptance", () => {
	it("round-trips type/inReplyTo/correlationId through disk", () => {
		const box = mailbox();
		const result = durableWrite("peer", "alice", "please review", {
			mailboxPath: box,
			senderId: "peer-id",
			type: "request",
			inReplyTo: "001.json",
			correlationId: "interaction-1",
		});

		expect(result.accepted).toBe(true);
		expect(transport.receive("peer", box)).toEqual([
			{
				id: result.reference,
				from: "alice",
				text: "please review",
				ts: expect.any(Number),
				senderId: "peer-id",
				type: "request",
				inReplyTo: "001.json",
				correlationId: "interaction-1",
			},
		]);
	});

	it("publishes the recipient-visible id as the sender's reference", () => {
		// The documented reply workflow is "pass the id message_read showed you".
		// That only works if the sender's reference and the receiver's id agree.
		const box = mailbox();
		const { reference } = durableWrite("peer", "alice", "ping", { mailboxPath: box });
		expect(transport.receive("peer", box)[0]?.id).toBe(reference);
	});

	it("treats legacy envelopes without metadata as ordinary messages", () => {
		const box = mailbox();
		dropRaw(box, "001.json", { id: "u", from: "bob", text: "ping", ts: 1 });
		expect(transport.receive("peer", box)).toEqual([{ id: "001.json", from: "bob", text: "ping", ts: 1 }]);
	});

	it("drops forged metadata instead of echoing it", () => {
		const box = mailbox();
		dropRaw(box, "002.json", {
			id: "u2",
			from: "bob",
			text: "t",
			ts: 2,
			type: "URGENT",
			inReplyTo: { nested: true },
			correlationId: 7,
			senderId: ["x"],
		});
		expect(transport.receive("peer", box)).toEqual([{ id: "002.json", from: "bob", text: "t", ts: 2 }]);
	});

	it("refuses an unsafe senderId rather than writing outside the mailbox", () => {
		const box = mailbox();
		const result = durableWrite("peer", "alice", "x", { mailboxPath: box, senderId: "../escape" });
		expect(result.accepted).toBe(false);
		expect(transport.receive("peer", box)).toEqual([]);
	});

	it("keeps the legacy string-target durableWrite contract", () => {
		const box = mailbox();
		const result = durableWrite("peer", "alice", "hello", box);
		expect(result.accepted).toBe(true);
		expect(transport.receive("peer", box)[0]?.text).toBe("hello");
	});
});
