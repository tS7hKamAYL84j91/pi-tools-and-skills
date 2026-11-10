/** Read-only routing identity; no messaging transport or registry lifecycle. */

import { closeSync, constants, fstatSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";
import { REGISTRY_DIR, normalizeNamespace } from "./agent-registry.js";
import { assertPrivateFileForRead, auditPrivateDirectory, PRIVATE_FILE_MODE } from "./private-local-mode.js";

const MAX_RECORD_BYTES = 64 * 1024;

/** No chmod/reaping; bound reads even if a regular file grows after fstat. */
function readIdentityRecord(path: string): Record<string, unknown> | undefined {
	assertPrivateFileForRead(path);
	// NONBLOCK prevents a raced-in FIFO from hanging open; fstat rejects it.
	const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || (stat.mode & 0o777) !== PRIVATE_FILE_MODE || stat.size > MAX_RECORD_BYTES) return undefined;
		const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
		let length = 0;
		while (length < buffer.length) {
			const count = readSync(fd, buffer, length, buffer.length - length, null);
			if (count === 0) break;
			length += count;
		}
		if (length > MAX_RECORD_BYTES) return undefined;
		return JSON.parse(buffer.subarray(0, length).toString("utf8")) as Record<string, unknown>;
	} finally {
		closeSync(fd);
	}
}

export interface AgentIdentity {
	id: string;
	name: string;
	namespace?: string;
	declared_name?: string;
}

/**
 * Match both PID and session file so another session's stale record cannot win.
 * Ephemeral sessions match records without a session file. Ambiguity fails
 * closed. Reads require a private registry directory and private regular files,
 * reject symlinks, and accept at most 64 KiB (one extra detection byte).
 * Unsafe records are ignored, never repaired or deleted.
 * Missing/corrupt records are normal without Agent Hub.
 */
export function findCurrentAgentIdentity(sessionFile: string | undefined): AgentIdentity | null {
	let identity: AgentIdentity | null = null;
	if (!auditPrivateDirectory(REGISTRY_DIR).ok) return null;
	try {
		for (const file of readdirSync(REGISTRY_DIR)) {
			if (!file.endsWith(".json")) continue;
			try {
				const record = readIdentityRecord(join(REGISTRY_DIR, file));
				if (!record || record.pid !== process.pid || record.sessionFile !== sessionFile ||
					typeof record.id !== "string" || typeof record.name !== "string") continue;
				if (identity) return null; // More than one match is ambiguous.
				identity = {
					id: record.id,
					name: record.name,
					namespace: normalizeNamespace(typeof record.namespace === "string" ? record.namespace : undefined),
					declared_name: typeof record.declared_name === "string" ? record.declared_name : undefined,
				};
			} catch { /* Ignore corrupt/unreadable records. */ }
		}
	} catch { /* Registry absent or unavailable. */ }
	return identity;
}
