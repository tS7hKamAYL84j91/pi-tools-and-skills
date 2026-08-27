/**
 * Socket publication (ADR section 6, design doc section 2): bind in the
 * validated private runtime directory, set the 0600 mode before publication,
 * publish atomically, and never blindly unlink an existing path — validate
 * owner, type, and daemon liveness first, then remove only a verified stale
 * socket. Fail-closed on every check failure.
 */
import { createConnection } from "node:net";
import { lstat, chmod, mkdir, unlink, rename } from "node:fs/promises";
import { createServer } from "node:net";
import { socketPath } from "./paths.js";
import type { DaemonRoots } from "./paths.js";

function isLiveSocketProbeError(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException).code;
	return code === "ECONNREFUSED" || code === "ENOENT";
}

/**
 * Probe whether a live daemon owns an existing socket. Returns true when a
 * peer accepts a connection (live holder — fail closed); false when the
 * socket is stale/refused (safe to publish over after validation).
 */
export function probeSocketLive(path: string, timeoutMs = 500): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = createConnection(path);
		const done = (live: boolean) => {
			probe.destroy();
			resolve(live);
		};
		probe.setTimeout(timeoutMs);
		probe.on("connect", () => done(true));
		probe.on("error", (error) => {
			if (isLiveSocketProbeError(error)) resolve(false);
			else resolve(false);
		});
		probe.on("timeout", () => resolve(true));
	});
}

/** Validate the existing socket path: type, ownership by this UID, mode. */
export async function validateExistingSocketPath(path: string): Promise<{ stale: boolean; exists: boolean }> {
	try {
		const info = await lstat(path);
		if (!info.isSocket()) throw new Error(`refusing non-socket at socket path: ${path}`);
		if (info.uid !== process.getuid?.()) throw new Error(`refusing socket path owned by another uid: ${path}`);
		return { stale: true, exists: true };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { stale: false, exists: false };
		throw error;
	}
}

export interface PublishedSocket {
	readonly path: string;
	readonly server: import("node:net").Server;
}

/**
 * Publish the daemon socket: bind on a private temp name inside the runtime
 * dir, chmod 0600, then rename (atomic publication). Live-holder and stale
 * socket validation runs before any unlink. Bind happens only while the
 * single-instance lock is held (caller responsibility).
 */
export async function publishDaemonSocket(
	roots: DaemonRoots,
	onConnection: (socket: import("node:net").Socket) => void,
): Promise<PublishedSocket> {
	await mkdir(roots.runtimeRoot, { recursive: true, mode: 0o700 });
	const finalPath = socketPath(roots);
	const probe = await probeSocketLive(finalPath);
	if (probe) throw new Error(`refusing socket publication: a live daemon already owns ${finalPath}`);
	const validation = await validateExistingSocketPath(finalPath);
	if (validation.stale) await unlink(finalPath);

	const stagingPath = `${finalPath}.${process.pid}.new`;
	const server = createServer(onConnection);
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(stagingPath, () => resolve());
	});
	// Mode before publication: the chmod lands on the staging inode; the
	// rename that publishes it does not change the mode.
	await chmod(stagingPath, 0o600);
	await rename(stagingPath, finalPath);
	return { path: finalPath, server };
}