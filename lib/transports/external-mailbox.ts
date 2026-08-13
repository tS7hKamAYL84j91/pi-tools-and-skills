/** Persistent external-agent mailbox path helpers. */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ensurePrivateDirectory } from "../private-local-mode.js";

/** Default root for persistent external-agent mailboxes. */
export function defaultPersistDir(): string {
	return join(homedir(), ".pi", "persist", "external-agents");
}

/** Return the final Maildir inbox path for an external agent. */
export function externalMailboxPath(agentId: string, mailboxRoot = defaultPersistDir()): string {
	return resolve(mailboxRoot, agentId, "inbox");
}

/** Ensure a final Maildir inbox path without adding agent-id/inbox segments. */
export function ensureExternalMailbox(mailboxPath: string): string {
	const base = resolve(mailboxPath);
	for (const dir of [base, join(base, "tmp"), join(base, "new"), join(base, "cur")]) {
		ensurePrivateDirectory(dir);
	}
	return base;
}
