/**
 * MaildirTransport — at-least-once delivery via Maildir.
 *
 * Messages are atomically written to the recipient's inbox
 * (tmp/ → new/) and delivered when the recipient drains.
 * Survives crashes, sleep, and agent restarts.
 */

import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { AgentRecord } from "../agent-registry.js";
import { REGISTRY_DIR } from "../agent-registry.js";
import type {
	DeliveryResult,
	InboundMessage,
	MessageTransport,
} from "../message-transport.js";

// ── Local InboxMessage type ─────────────────────────────────────

interface InboxMessage {
	id: string;
	from: string;
	text: string;
	ts: number;
	metadata?: Record<string, unknown>;
}

// ── Maildir inbox helpers (private) ────────────────────────────

function ensureInbox(agentId: string): string {
	const inboxPath = join(REGISTRY_DIR, agentId, "inbox");
	for (const sub of ["tmp", "new", "cur"]) {
		mkdirSync(join(inboxPath, sub), { recursive: true });
	}
	return inboxPath;
}

function inboxReadNew(
	agentId: string,
): { filename: string; message: InboxMessage }[] {
	try {
		const newDir = join(REGISTRY_DIR, agentId, "inbox", "new");
		return readdirSync(newDir)
			.filter((f) => f.endsWith(".json"))
			.sort()
			.flatMap((f) => {
				try {
					return [
						{
							filename: f,
							message: JSON.parse(
								readFileSync(join(newDir, f), "utf-8"),
							) as InboxMessage,
						},
					];
				} catch {
					return [];
				}
			});
	} catch {
		return [];
	}
}

function inboxAcknowledge(agentId: string, filename: string): void {
	try {
		renameSync(
			join(REGISTRY_DIR, agentId, "inbox", "new", filename),
			join(REGISTRY_DIR, agentId, "inbox", "cur", filename),
		);
	} catch {
		/* best-effort: message may already be moved */
	}
}

function inboxPruneCur(agentId: string, keep = 50): void {
	try {
		const curDir = join(REGISTRY_DIR, agentId, "inbox", "cur");
		const files = readdirSync(curDir)
			.filter((f) => f.endsWith(".json"))
			.sort();
		for (const f of files.slice(0, files.length - keep)) {
			try {
				unlinkSync(join(curDir, f));
			} catch {
				/* */
			}
		}
	} catch {
		/* */
	}
}

// ── Atomic Maildir write (tmp/ → new/) ─────────────────────────

function durableWrite(
	targetId: string,
	from: string,
	text: string,
): DeliveryResult {
	try {
		const inboxBase = ensureInbox(targetId);
		const ts = Date.now();
		const uuid = randomUUID();
		const filename = `${ts}-${uuid}.json`;

		const tmpPath = join(inboxBase, "tmp", filename);
		writeFileSync(
			tmpPath,
			JSON.stringify({ id: uuid, from, text, ts }),
			"utf-8",
		);

		renameSync(tmpPath, join(inboxBase, "new", filename));

		return { accepted: true, immediate: false, reference: filename };
	} catch (err) {
		return { accepted: false, immediate: false, error: String(err) };
	}
}

// ── MaildirTransport ────────────────────────────────────────────

class MaildirTransport implements MessageTransport {
	async send(
		peer: AgentRecord,
		from: string,
		message: string,
	): Promise<DeliveryResult> {
		return durableWrite(peer.id, from, message);
	}

	receive(agentId: string): InboundMessage[] {
		return inboxReadNew(agentId).map(({ filename, message }) => ({
			id: filename,
			from: message.from,
			text: message.text,
			ts: message.ts,
		}));
	}

	ack(agentId: string, messageId: string): void {
		inboxAcknowledge(agentId, messageId);
	}

	prune(agentId: string): void {
		inboxPruneCur(agentId);
	}

	init(agentId: string): void {
		ensureInbox(agentId);
	}

	pendingCount(agentId: string): number {
		try {
			return readdirSync(join(REGISTRY_DIR, agentId, "inbox", "new")).filter(
				(f) => f.endsWith(".json"),
			).length;
		} catch {
			return 0;
		}
	}
}

// ── Factory ─────────────────────────────────────────────────────

export function createMaildirTransport(): MessageTransport {
	return new MaildirTransport();
}
