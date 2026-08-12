/**
 * External agent mailbox path helpers.
 *
 * External agents keep their durable mailbox outside the volatile
 * `~/.pi/agents/` registry directory so it survives registry wipes.
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Default base directory for persistent external agent mailboxes. */
export function defaultPersistDir(): string {
	return join(homedir(), ".pi", "persist", "external-agents");
}

/** Resolve an external agent mailbox path. */
export function externalMailboxPath(agentId: string, baseDir?: string): string {
	return resolve(baseDir ?? defaultPersistDir(), agentId, "inbox");
}

/** Ensure the external mailbox directory tree exists. */
export async function ensureExternalMailbox(agentId: string, baseDir?: string): Promise<string> {
	const base = externalMailboxPath(agentId, baseDir);
	const dirs = [base, join(base, "tmp"), join(base, "new"), join(base, "cur")];
	for (const dir of dirs) {
		if (!existsSync(dir)) {
			await mkdir(dir, { recursive: true, mode: 0o700 });
		}
	}
	return base;
}
