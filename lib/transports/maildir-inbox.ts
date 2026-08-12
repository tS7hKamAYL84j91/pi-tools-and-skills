/**
 * Maildir inbox path helpers and read/write primitives.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { REGISTRY_DIR, ensureRegistryDir } from "../agent-registry.js";
import type { AgentRecord } from "../agent-registry.js";
import {
	assertPrivateFileTarget,
	ensurePrivateDirectory,
	ensurePrivateFileForRead,
	writeNewPrivateFileSync,
} from "../private-local-mode.js";
import { externalMailboxPath } from "./external-mailbox.js";
import type { DeliveryResult, InboundMessage } from "../message-transport.js";

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

export function ensureInboxForRecord(record: AgentRecord): string {
	if (record.kind === "external") {
		return ensureExternalMailboxSync(record.id, record.mailboxPath);
	}
	return ensurePiInbox(record.id);
}

function ensureExternalMailboxSync(agentId: string, mailboxPath?: string): string {
	const base = mailboxPath ? resolve(mailboxPath) : externalMailboxPath(agentId);
	for (const dir of [base, join(base, "tmp"), join(base, "new"), join(base, "cur")]) {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
	}
	return base;
}

function ensurePiInbox(agentId: string): string {
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
								return JSON.parse(readFileSync(messagePath, "utf-8")) as InboundMessage;
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

export function durableWrite(
	targetId: string,
	from: string,
	text: string,
	mailboxPath?: string,
): DeliveryResult {
	try {
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
		writeNewPrivateFileSync(tmpPath, JSON.stringify({ id: uuid, from, text, ts }));

		const newPath = join(base, "new", filename);
		assertPrivateFileTarget(newPath);
		renameSync(tmpPath, newPath);

		return { accepted: true, immediate: false, reference: filename };
	} catch (err) {
		return { accepted: false, immediate: false, error: String(err) };
	}
}
