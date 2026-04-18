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
	rmSync,
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

// ── Maildir inbox helpers (private) ────────────────────────────

function inboxPaths(agentId: string) {
	const base = join(REGISTRY_DIR, agentId, "inbox");
	return { base, tmp: join(base, "tmp"), new: join(base, "new"), cur: join(base, "cur") };
}

function ensureInbox(agentId: string): string {
	const paths = inboxPaths(agentId);
	for (const dir of [paths.tmp, paths.new, paths.cur]) {
		mkdirSync(dir, { recursive: true });
	}
	return paths.base;
}

function inboxReadNew(
	agentId: string,
): { filename: string; message: InboundMessage }[] {
	try {
		const { new: newDir } = inboxPaths(agentId);
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
							) as InboundMessage,
						},
					];
				} catch {
					/* skip unreadable/corrupt message */
					return [];
				}
			});
	} catch {
		/* inbox dir may not exist */
		return [];
	}
}

function inboxAcknowledge(agentId: string, filename: string): void {
	const paths = inboxPaths(agentId);
	try {
		renameSync(
			join(paths.new, filename),
			join(paths.cur, filename),
		);
	} catch {
		/* best-effort: message may already be moved */
	}
}

function inboxPruneCur(agentId: string, keep = 50): void {
	try {
		const { cur: curDir } = inboxPaths(agentId);
		const files = readdirSync(curDir)
			.filter((f) => f.endsWith(".json"))
			.sort();
		for (const f of files.slice(0, files.length - keep)) {
			try {
				unlinkSync(join(curDir, f));
			} catch {
				/* best-effort: file may already be gone */
			}
		}
	} catch {
		/* best-effort: cur dir may not exist */
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
			...message,
			id: filename,
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
			return readdirSync(inboxPaths(agentId).new).filter(
				(f) => f.endsWith(".json"),
			).length;
		} catch {
			return 0;
		}
	}

	cleanup(agentId: string): void {
		try {
			rmSync(join(REGISTRY_DIR, agentId), {
				recursive: true,
				force: true,
			});
		} catch {
			/* best-effort */
		}
	}
}

// ── Factory + singleton ────────────────────────────────────────

/** Create a fresh instance — use for tests and separate-process scripts. */
export function createMaildirTransport(): MessageTransport { return new MaildirTransport(); }

let shared: MessageTransport | undefined;
/** Shared singleton for in-process use (extensions, agent-api). */
export function getMaildirTransport(): MessageTransport {
	if (!shared) shared = new MaildirTransport();
	return shared;
}
