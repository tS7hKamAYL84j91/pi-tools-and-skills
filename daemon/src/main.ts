/**
 * coas-daemon main entrypoint (design doc section 1, ADR-0018 implementation
 * path item 1): acquire the single-instance lock, bootstrap the integrity
 * key, publish the 0600 socket, and serve until SIGTERM/SIGINT. Graceful
 * shutdown releases the lock; the failure-threshold policy owns restarts
 * (systemd unit uses Restart=no).
 *
 * Run: node --experimental-strip-types? No — build via `tsc -p daemon/tsconfig.json`
 * is not wired for emit in the repo (typecheck-only). The launcher entrypoint
 * is this module; see daemon/README.md for the systemd/nohup instructions.
 */
import { acquireSingleInstanceLock, releaseSingleInstanceLock } from "./lock.js";
import { loadOrCreateIntegrityKey } from "./keys.js";
import { publishDaemonSocket, type PublishedSocket } from "./socket.js";
import { appendAudit } from "./audit.js";
import { daemonRoots } from "./paths.js";

export interface DaemonBootstrap {
	readonly startedAt: string;
	readonly posture: string;
	readonly keyId: string;
	readonly socketPath: string;
	readonly socket: PublishedSocket;
	readonly stop: () => Promise<void>;
}

/**
 * Bootstrap the daemon: lock -> key -> socket. Fails closed (process exit
 * non-zero is the caller's concern; errors propagate) when another live
 * daemon holds the lock or the socket.
 */
export async function bootstrapDaemon(roots = daemonRoots()): Promise<DaemonBootstrap> {
	const lock = await acquireSingleInstanceLock(roots);
	if (!lock.acquired) {
		throw new Error(`coas-daemon: another live daemon holds the single-instance lock (pid ${lock.liveHolderPid})`);
	}
	try {
		const keys = await loadOrCreateIntegrityKey(roots, (event) => appendAudit(roots, event, { durable: true }));
		const socket = await publishDaemonSocket(roots, () => {
			// Connection handler is wired by the serve loop (T-868: A2A queue);
			// the control-plane dispatch lands with the queue slice.
		});
		const startedAt = new Date().toISOString();
		await appendAudit(roots, {
			kind: "daemon_started",
			posture: keys.fallbackFileUsed ? "same_uid_untrusted(key_fallback)" : "same_uid_untrusted",
			keyId: keys.keyId,
			...(lock.tookOverFrom !== undefined ? { tookOverFrom: lock.tookOverFrom } : {}),
		}, { durable: true });

		let stopped = false;
		const stop = async (): Promise<void> => {
			if (stopped) return;
			stopped = true;
			socket.server.close();
			await releaseSingleInstanceLock(roots);
			await appendAudit(roots, { kind: "daemon_stopped" }, { durable: true });
		};
		return { startedAt, posture: "same_uid_untrusted", keyId: keys.keyId, socketPath: socket.path, socket, stop };
	} catch (error) {
		// Fail closed: never leave a lock held by a daemon that did not start.
		await releaseSingleInstanceLock(roots).catch(() => {});
		throw error;
	}
}

/** CLI entrypoint (invoked by the systemd unit / nohup): run until signalled. */
export async function runUntilSignal(roots = daemonRoots()): Promise<void> {
	const bootstrap = await bootstrapDaemon(roots);
	const shutdown = (): void => {
		void bootstrap.stop().then(() => process.exit(0), () => process.exit(1));
	};
	process.once("SIGTERM", shutdown);
	process.once("SIGINT", shutdown);
}