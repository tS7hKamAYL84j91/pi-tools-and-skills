/**
 * Published daemon protocol path surface (ADR-053): the filesystem roots and
 * socket location a client needs to reach the daemon control plane
 * (ADR-0018). Daemon-only helpers (lock/queue/audit locations, opaque-id
 * validation) stay private in daemon/src/paths.ts.
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

export function socketPath(roots: DaemonRoots): string {
	return join(roots.runtimeRoot, "daemon.sock");
}
