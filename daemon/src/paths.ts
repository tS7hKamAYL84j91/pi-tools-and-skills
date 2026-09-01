/**
 * Daemon-owned filesystem roots and opaque-id validation.
 *
 * Implements the store hierarchy from planning/T-819-DAEMON-DESIGN.md section 2.
 * All creation/recovery paths bind to the ADR-0018 section 6 checklist; see
 * safe-create helpers in this package. The client-facing roots and socket
 * path are published from lib/daemon-protocol/paths.ts (ADR-053) and
 * re-exported here so daemon-internal consumers are unchanged.
 */
import { join } from "node:path";
import type { DaemonRoots } from "../../lib/daemon-protocol/paths.js";

export { daemonRoots, socketPath } from "../../lib/daemon-protocol/paths.js";
export type { DaemonRoots };

export function lockPath(roots: DaemonRoots): string {
	return join(roots.runtimeRoot, "daemon.lock");
}

export function identitiesDir(roots: DaemonRoots): string {
	return join(roots.stateRoot, "registry", "identities");
}

export function queueDir(roots: DaemonRoots): string {
	return join(roots.stateRoot, "queue");
}

export function deadLetterDir(roots: DaemonRoots): string {
	return join(queueDir(roots), "dead-letter");
}

export function quarantineDir(roots: DaemonRoots): string {
	return join(queueDir(roots), "quarantine");
}

export function scheduleStateDir(roots: DaemonRoots): string {
	return join(roots.stateRoot, "schedule-state");
}

export function auditDir(roots: DaemonRoots): string {
	return join(roots.stateRoot, "audit");
}

export function publicKeysDir(roots: DaemonRoots): string {
	return join(roots.stateRoot, "keys", "public");
}

/**
 * Opaque-id validation for path components (same shape as the maildir
 * transport discipline; user-provided names never enter paths, ADR section 6).
 */
export function assertSafeId(label: string, id: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes("..")) {
		throw new Error(`unsafe ${label}: ${id || "(empty)"}`);
	}
	return id;
}