/**
 * Daemon-owned filesystem roots and opaque-id validation.
 *
 * Implements the store hierarchy from planning/T-819-DAEMON-DESIGN.md section 2.
 * All creation/recovery paths bind to the ADR-0018 section 6 checklist; see
 * safe-create helpers in this package.
 */
import { join } from "node:path";

export interface DaemonRoots {
	readonly runtimeRoot: string;
	readonly stateRoot: string;
}

/** Resolved daemon roots; overridable for tests via explicit values. */
export function daemonRoots(env: NodeJS.ProcessEnv = process.env): DaemonRoots {
	const runtimeBase = env.XDG_RUNTIME_DIR ?? join(env.HOME ?? "/tmp", ".runtime");
	const dataBase = env.XDG_DATA_HOME ?? join(env.HOME ?? "/tmp", ".local", "share");
	return {
		runtimeRoot: join(runtimeBase, "coas"),
		stateRoot: join(dataBase, "coas-daemon"),
	};
}

export function lockPath(roots: DaemonRoots): string {
	return join(roots.runtimeRoot, "daemon.lock");
}

export function socketPath(roots: DaemonRoots): string {
	return join(roots.runtimeRoot, "daemon.sock");
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