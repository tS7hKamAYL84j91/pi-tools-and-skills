/**
 * MaildirTransport — at-least-once delivery via Maildir.
 *
 * Messages are atomically written to the recipient's inbox
 * (tmp/ → new/) and delivered when the recipient drains.
 * Survives crashes, sleep, and agent restarts.
 */

import { writeFileSync, renameSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
	ensureInbox,
	inboxReadNew,
	inboxAcknowledge,
	inboxPruneCur,
	REGISTRY_DIR,
} from "../agent-registry.js";
import type { AgentRecord } from "../agent-registry.js";
import type {
	MessageTransport,
	DeliveryResult,
	InboundMessage,
} from "../message-transport.js";

// ── Atomic Maildir write (tmp/ → new/) ─────────────────────────

function durableWrite(targetId: string, from: string, text: string): DeliveryResult {
	try {
		const inboxBase = ensureInbox(targetId);
		const ts = Date.now();
		const uuid = randomUUID();
		const filename = `${ts}-${uuid}.json`;

		const tmpPath = join(inboxBase, "tmp", filename);
		writeFileSync(tmpPath, JSON.stringify({ id: uuid, from, text, ts }), "utf-8");

		renameSync(tmpPath, join(inboxBase, "new", filename));

		return { accepted: true, immediate: false, reference: filename };
	} catch (err) {
		return { accepted: false, immediate: false, error: String(err) };
	}
}

// ── MaildirTransport ────────────────────────────────────────────

class MaildirTransport implements MessageTransport {
	async send(peer: AgentRecord, from: string, message: string): Promise<DeliveryResult> {
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
			return readdirSync(join(REGISTRY_DIR, agentId, "inbox", "new"))
				.filter((f) => f.endsWith(".json")).length;
		} catch {
			return 0;
		}
	}
}

// ── Factory ─────────────────────────────────────────────────────

export function createMaildirTransport(): MessageTransport {
	return new MaildirTransport();
}
