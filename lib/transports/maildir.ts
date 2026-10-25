/** Maildir transport and its inbox primitives. */

import { readdirSync, readFileSync, renameSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentRecord } from "../agent-registry.js";
import { REGISTRY_DIR, ensureRegistryDir } from "../agent-registry.js";
import {
	assertPrivateFileTarget,
	ensurePrivateDirectory,
	ensurePrivateFileForRead,
	writeNewPrivateFileSync,
} from "../private-local-mode.js";
import type {
	DeliveryResult,
	InboundAttachment,
	InboundMessage,
	MessageMetadata,
	MessageTransport,
} from "../message-transport.js";
import { metadataString, normalizeMessageMetadata } from "../message-transport.js";
export function assertSafeAgentId(agentId: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(agentId)) {
		throw new Error(`invalid agent id for Maildir path: ${agentId || "(empty)"}`);
	}
}
export function inboxBase(agentId: string, mailboxPath?: string): string {
	assertSafeAgentId(agentId);
	return mailboxPath ? mailboxPath : join(REGISTRY_DIR, agentId, "inbox");
}
export function inboxPaths(agentId: string, mailboxPath?: string) {
	const base = inboxBase(agentId, mailboxPath);
	return { base, tmp: join(base, "tmp"), new: join(base, "new"), cur: join(base, "cur") };
}
/** Ensure the volatile Maildir inbox used by a pi agent. */
export function ensurePiInbox(agentId: string): string {
	assertSafeAgentId(agentId);
	ensureRegistryDir();
	const paths = inboxPaths(agentId);
	const agentDir = join(REGISTRY_DIR, agentId);
	for (const dir of [agentDir, paths.base, paths.tmp, paths.new, paths.cur]) {
		ensurePrivateDirectory(dir);
	}
	return paths.base;
}
export function inboxReadNew(
	agentId: string,
	mailboxPath?: string,
): { filename: string; message: InboundMessage }[] {
	try {
		const { new: newDir } = inboxPaths(agentId, mailboxPath);
		return readdirSync(newDir)
			.filter((f) => f.endsWith(".json"))
			.sort()
			.flatMap((f) => {
				try {
					return [
						{
							filename: f,
							message: (() => {
								const messagePath = join(newDir, f);
								ensurePrivateFileForRead(messagePath);
								return normalizeStoredMessage(JSON.parse(readFileSync(messagePath, "utf-8")));
							})(),
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

const ATTACHMENT_KINDS = ["image", "file", "audio", "video"] as const;

/** Accept only a well-formed attachment record; unknown shapes are dropped. */
function normalizeAttachment(value: unknown): InboundAttachment | undefined {
	if (value === null || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const kind = metadataString(raw.kind);
	const filename = metadataString(raw.filename);
	const eventId = metadataString(raw.eventId);
	if (!kind || !(ATTACHMENT_KINDS as readonly string[]).includes(kind) || !filename || !eventId) {
		return undefined;
	}
	const attachment: InboundAttachment = {
		kind: kind as InboundAttachment["kind"],
		filename,
		eventId,
	};
	for (const key of ["mimeType", "localPath", "mxcUrl", "roomId", "senderMxid", "error"] as const) {
		const field = metadataString(raw[key]);
		if (field) attachment[key] = field;
	}
	if (typeof raw.sizeBytes === "number" && Number.isFinite(raw.sizeBytes)) attachment.sizeBytes = raw.sizeBytes;
	if (typeof raw.timestampMs === "number" && Number.isFinite(raw.timestampMs)) attachment.timestampMs = raw.timestampMs;
	if (raw.encrypted === true) attachment.encrypted = true;
	return attachment;
}

/**
 * Coerce a stored envelope to the documented shape. Metadata fields are
 * accepted only as non-empty strings (type must be a documented value), so a
 * forged or corrupt envelope cannot inject objects/numbers into structured
 * tool output.
 */
function normalizeStoredMessage(value: unknown): InboundMessage {
	const raw = (value !== null && typeof value === "object" ? value : {}) as Record<string, unknown>;
	const message: InboundMessage = {
		id: typeof raw.id === "string" ? raw.id : "",
		from: typeof raw.from === "string" ? raw.from : "",
		text: typeof raw.text === "string" ? raw.text : "",
		ts: typeof raw.ts === "number" ? raw.ts : 0,
	};
	const senderId = metadataString(raw.senderId);
	if (senderId) message.senderId = senderId;
	const meta = normalizeMessageMetadata(raw);
	if (meta.type) message.type = meta.type;
	if (meta.inReplyTo) message.inReplyTo = meta.inReplyTo;
	if (meta.correlationId) message.correlationId = meta.correlationId;
	if (Array.isArray(raw.attachments)) {
		const attachments = raw.attachments
			.map(normalizeAttachment)
			.filter((attachment): attachment is InboundAttachment => attachment !== undefined);
		if (attachments.length > 0) message.attachments = attachments;
	}
	return message;
}
export function inboxAcknowledge(agentId: string, filename: string, mailboxPath?: string): void {
	try {
		const paths = inboxPaths(agentId, mailboxPath);
		renameSync(join(paths.new, filename), join(paths.cur, filename));
	} catch {
		/* best-effort: message may already be moved */
	}
}
export function inboxPruneCur(agentId: string, keep = 50, mailboxPath?: string): void {
	try {
		const { cur: curDir } = inboxPaths(agentId, mailboxPath);
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
export interface DurableWriteTarget extends MessageMetadata {
	mailboxPath?: string;
	senderId?: string;
}

export function durableWrite(
	targetId: string,
	from: string,
	text: string,
	target?: string | DurableWriteTarget,
): DeliveryResult {
	try {
		// A string target is a mailbox path (legacy contract); an object supplies
		// the path plus sender and descriptive metadata.
		const options: DurableWriteTarget = typeof target === "string" ? { mailboxPath: target } : (target ?? {});
		const mailboxPath = options.mailboxPath;
		const senderId = options.senderId;
		if (senderId !== undefined) assertSafeAgentId(senderId);
		const meta = normalizeMessageMetadata(options);
		const base = inboxPaths(targetId, mailboxPath).base;
		ensurePrivateDirectory(base);
		ensurePrivateDirectory(join(base, "tmp"));
		ensurePrivateDirectory(join(base, "new"));
		ensurePrivateDirectory(join(base, "cur"));
		const ts = Date.now();
		const uuid = randomUUID();
		const filename = `${ts}-${uuid}.json`;
		const tmpPath = join(base, "tmp", filename);
		assertPrivateFileTarget(tmpPath);
		const envelope: InboundMessage = { id: uuid, from, text, ts };
		if (senderId) envelope.senderId = senderId;
		if (meta.type) envelope.type = meta.type;
		if (meta.inReplyTo) envelope.inReplyTo = meta.inReplyTo;
		if (meta.correlationId) envelope.correlationId = meta.correlationId;
		writeNewPrivateFileSync(tmpPath, JSON.stringify(envelope));
		const newPath = join(base, "new", filename);
		assertPrivateFileTarget(newPath);
		renameSync(tmpPath, newPath);
		return { accepted: true, immediate: false, reference: filename };
	} catch (err) {
		return { accepted: false, immediate: false, error: String(err) };
	}
}
class MaildirTransport implements MessageTransport {
	async send(
		peer: AgentRecord,
		from: string,
		message: string,
		senderId?: string,
		meta?: MessageMetadata,
	): Promise<DeliveryResult> {
		if (peer.kind === "external" && !peer.mailboxPath) {
			return {
				accepted: false,
				immediate: false,
				error: `External agent ${peer.id} has no mailbox path`,
			};
		}
		const mailboxPath = peer.kind === "external" ? peer.mailboxPath : undefined;
		return durableWrite(peer.id, from, message, { mailboxPath, senderId, ...meta });
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
