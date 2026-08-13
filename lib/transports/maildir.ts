/**
 * MaildirTransport — at-least-once delivery via Maildir.
 *
 * Messages are atomically written to the recipient's inbox
 * (tmp/ → new/) and delivered when the recipient drains.
 * Survives crashes, sleep, and agent restarts.
 */

import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AgentRecord } from "../agent-registry.js";
import { REGISTRY_DIR } from "../agent-registry.js";
import type { DeliveryResult, InboundMessage, MessageTransport } from "../message-transport.js";
import {
	assertSafeAgentId,
	durableWrite,
	inboxAcknowledge,
	inboxPruneCur,
	inboxReadNew,
	inboxPaths,
	ensurePiInbox,
} from "./maildir-inbox.js";

class MaildirTransport implements MessageTransport {
	async send(peer: AgentRecord, from: string, message: string): Promise<DeliveryResult> {
		if (peer.kind === "external" && !peer.mailboxPath) {
			return {
				accepted: false,
				immediate: false,
				error: `External agent ${peer.id} has no mailbox path`,
			};
		}
		const mailboxPath = peer.kind === "external" ? peer.mailboxPath : undefined;
		return durableWrite(peer.id, from, message, mailboxPath);
	}

	receive(agentId: string, mailboxPath?: string): InboundMessage[] {
		return inboxReadNew(agentId, mailboxPath).map(({ filename, message }) => ({
			...message,
			id: filename,
		}));
	}

	ack(agentId: string, messageId: string, mailboxPath?: string): void {
		inboxAcknowledge(agentId, messageId, mailboxPath);
	}

	prune(agentId: string, mailboxPath?: string): void {
		inboxPruneCur(agentId, 50, mailboxPath);
	}

	init(agentId: string): void {
		ensurePiInbox(agentId);
	}

	pendingCount(agentId: string, mailboxPath?: string): number {
		try {
			return readdirSync(inboxPaths(agentId, mailboxPath).new).filter(
				(f) => f.endsWith(".json"),
			).length;
		} catch {
			return 0;
		}
	}

	cleanup(agentId: string): void {
		try {
			assertSafeAgentId(agentId);
			const target = join(REGISTRY_DIR, agentId);
			// Guard: only delete paths under the volatile registry directory.
			if (!target.startsWith(REGISTRY_DIR)) {
				return;
			}
			rmSync(target, { recursive: true, force: true });
		} catch {
			/* best-effort */
		}
	}
}

/** Create a fresh instance — use for tests and separate-process scripts. */
export function createMaildirTransport(): MessageTransport {
	return new MaildirTransport();
}

let shared: MessageTransport | undefined;
/** Shared singleton for in-process use (extensions, agent-api). */
export function getMaildirTransport(): MessageTransport {
	if (!shared) shared = new MaildirTransport();
	return shared;
}
