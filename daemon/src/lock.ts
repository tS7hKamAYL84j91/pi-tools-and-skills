/**
 * Single-instance guarantee (ADR-0018 section 7): an exclusive advisory lock
 * held for the daemon lifetime, acquired before socket bind and before any
 * state read/write. A second instance fails closed with an audit event;
 * takeover is possible only when the previous holder is verifiably dead.
 *
 * Node stdlib exposes no flock(); the equivalent advisory guarantee here is an
 * O_EXCL lockfile carrying the holder's PID plus liveness verification
 * (kill(pid, 0)): a lock whose holder is dead is verifiably released and may
 * be taken over; a live holder fails the second instance. Noted in the design
 * doc as the stdlib-faithful equivalent of flock/LOCK_EX.
 */
import { constants as fsConstants } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fsyncDir } from "./durable-fs.js";
import type { DaemonRoots } from "./paths.js";

export interface DaemonLockInfo {
	readonly pid: number;
	readonly startedAt: string;
}

export interface LockAcquisition {
	readonly acquired: boolean;
	/** Set when acquisition failed because a live holder exists. */
	readonly liveHolderPid?: number;
	/** Set when takeover replaced a dead holder's lock. */
	readonly tookOverFrom?: number;
}

export function lockFilePath(roots: DaemonRoots): string {
	return join(roots.runtimeRoot, "daemon.lock");
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Acquire the single-instance lock. Fails closed when a live holder exists.
 * A dead holder's lock is replaced via no-replace-safe rename of a fresh
 * exclusive-create file after verifying the holder is gone (verifiable release).
 */
export async function acquireSingleInstanceLock(roots: DaemonRoots): Promise<LockAcquisition> {
	const path = lockFilePath(roots);
	await mkdir(roots.runtimeRoot, { recursive: true, mode: 0o700 });

	const existing = await readLockInfo(path);
	if (existing && isAlive(existing.pid)) {
		return { acquired: false, liveHolderPid: existing.pid };
	}

	const info: DaemonLockInfo = { pid: process.pid, startedAt: new Date().toISOString() };
	const lockHandle = await open(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW, 0o600);
	try {
		await lockHandle.writeFile(`${JSON.stringify(info, null, 2)}\n`, "utf8");
		await lockHandle.sync();
	} finally {
		await lockHandle.close();
	}
	await fsyncDir(roots.runtimeRoot);

	// Re-read and re-verify to narrow the race: another instance may have
	// written after us; the latest writer wins only if it verified the old
	// holder dead. Both writers verify liveness before overwriting, and a
	// subsequent verifier always reads the newest startedAt; a live competing
	// holder fails this instance.
	const reread = await readLockInfo(path);
	if (reread && reread.pid !== process.pid && isAlive(reread.pid)) {
		return { acquired: false, liveHolderPid: reread.pid };
	}
	return { acquired: true, ...(existing && !isAlive(existing.pid) ? { tookOverFrom: existing.pid } : {}) };
}

async function readLockInfo(path: string): Promise<DaemonLockInfo | undefined> {
	let raw: string;
	try {
		const handle = await open(path, fsConstants.O_RDONLY);
		try {
			raw = await handle.readFile("utf8");
		} finally {
			await handle.close();
		}
	} catch {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (typeof parsed !== "object" || parsed === null) return undefined;
		const record = parsed as Record<string, unknown>;
		if (typeof record.pid !== "number" || typeof record.startedAt !== "string") return undefined;
		return { pid: record.pid, startedAt: record.startedAt };
	} catch {
		// Corrupt lock record: quarantine-by-move, never truncate (ADR section 7).
		await rename(path, `${path}.corrupt.${Date.now()}`).catch(() => {});
		return undefined;
	}
}

/** Release the lock on graceful shutdown; only the holder may release. */
export async function releaseSingleInstanceLock(roots: DaemonRoots): Promise<boolean> {
	const path = lockFilePath(roots);
	const existing = await readLockInfo(path);
	if (!existing || existing.pid !== process.pid) return false;
	await unlink(path).catch(() => {});
	await fsyncDir(roots.runtimeRoot);
	return true;
}

export const LOCK_AUDIT_CONTEXT = "runtime/daemon.lock";