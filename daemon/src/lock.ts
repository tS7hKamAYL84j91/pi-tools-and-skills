/**
 * Single-instance guarantee (ADR-0018 section 7): an exclusive advisory lock
 * held for the daemon lifetime, acquired before socket bind and before any
 * state read/write. A second instance fails closed; takeover is possible only
 * when the previous holder is verifiably dead.
 *
 * Node stdlib exposes no flock(); the advisory guarantee here is an
 * O_EXCL-created lockfile carrying the holder's PID plus liveness
 * verification (kill(pid, 0)) with inode-identity re-verification on
 * takeover. Corrupt/ambiguous lock state fails closed (no self-heal). The
 * design doc's implementation notes record this as the stdlib-faithful
 * equivalent of the ADR's flock/LOCK_EX requirement.
 */
import { constants as fsConstants } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { fsyncDir } from "./durable-fs.js";
import { lockPath as lockFilePath } from "./paths.js";
import type { DaemonRoots } from "./paths.js";

export class CorruptLockError extends Error {}

export interface LockRead {
	readonly info: DaemonLockInfo | undefined;
	readonly corrupt: boolean;
}

export interface DaemonLockInfo {
	readonly pid: number;
	readonly startedAt: string;
	readonly inode?: number;
}

export interface LockAcquisition {
	readonly acquired: boolean;
	/** Set when acquisition failed because a live holder exists. */
	readonly liveHolderPid?: number;
	/** Set when takeover replaced a dead holder's lock. */
	readonly tookOverFrom?: number;
	/** Set when the lock file was corrupt/ambiguous: fail closed, no self-heal. */
	readonly corrupt?: boolean;
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function parseLockRecord(raw: string): { pid: number; startedAt: string } | undefined {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (typeof parsed !== "object" || parsed === null) return undefined;
		const record = parsed as Record<string, unknown>;
		if (typeof record.pid !== "number" || typeof record.startedAt !== "string") return undefined;
		return { pid: record.pid, startedAt: record.startedAt };
	} catch {
		return undefined;
	}
}

async function readLockWithInode(path: string): Promise<LockRead> {
	const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW).catch(
		(error: NodeJS.ErrnoException): undefined => {
			if (error.code === "ENOENT") return undefined;
			throw new CorruptLockError(`lock file unreadable: ${error.message}`);
		},
	);
	if (!handle) return { info: undefined, corrupt: false };
	try {
		const raw = await handle.readFile("utf8");
		const parsed = parseLockRecord(raw);
		if (!parsed) throw new CorruptLockError("lock file is not a valid lock record");
		const inode = (await handle.stat()).ino;
		return { info: { ...parsed, inode }, corrupt: false };
	} finally {
		await handle.close();
	}
}

interface LockContext {
	readonly path: string;
	readonly runtimeRoot: string;
}

async function createLockExclusive(ctx: LockContext): Promise<boolean> {
	const handle = await open(ctx.path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600).catch(
		(error: NodeJS.ErrnoException): undefined => {
			if (error.code === "EEXIST") return undefined;
			throw error;
		},
	);
	if (!handle) return false;
	try {
		await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	await fsyncDir(ctx.runtimeRoot);
	return true;
}

async function takeoverDeadHolder(ctx: LockContext, dead: DaemonLockInfo): Promise<boolean> {
	const staging = `${ctx.path}.takeover.${process.pid}`;
	const stagingHandle = await open(
		staging,
		fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
		0o600,
	);
	try {
		await stagingHandle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
		await stagingHandle.sync();
	} finally {
		await stagingHandle.close();
	}
	// Re-verify holder death and inode identity immediately before replace
	// (guards against path substitution and a concurrent takeover winner).
	const recheck = await readLockWithInode(ctx.path).catch((): LockRead => ({ info: undefined, corrupt: true }));
	if (
		!recheck.info ||
		recheck.info.pid !== dead.pid ||
		(dead.inode !== undefined && recheck.info.inode !== undefined && dead.inode !== recheck.info.inode)
	) {
		await unlink(staging).catch(() => {});
		return false;
	}
	await rename(staging, ctx.path);
	await fsyncDir(ctx.runtimeRoot);
	return true;
}

/**
 * Acquire the single-instance lock. The exclusive O_EXCL create is the
 * serialization point (no O_TRUNC clobber race). On an existing lock the
 * holder's liveness is verified: a live holder fails closed; a verifiably
 * dead holder is taken over via a fresh exclusive staging file plus an
 * inode-identity re-check before the atomic replace. Corrupt or ambiguous
 * lock state fails closed with CorruptLockError (no self-heal, ADR section 7).
 */
export async function acquireSingleInstanceLock(roots: DaemonRoots): Promise<LockAcquisition> {
	const ctx: LockContext = { path: lockFilePath(roots), runtimeRoot: roots.runtimeRoot };
	await mkdir(roots.runtimeRoot, { recursive: true, mode: 0o700 });

	let created: boolean;
	try {
		created = await createLockExclusive(ctx);
	} catch (error) {
		if (error instanceof CorruptLockError) return { acquired: false, corrupt: true };
		throw error;
	}
	if (created) return { acquired: true };

	const existing = await readLockWithInode(ctx.path).catch((error: unknown) => {
		if (error instanceof CorruptLockError) return { info: undefined, corrupt: true } as LockRead;
		throw error;
	});
	if (existing.corrupt) return { acquired: false, corrupt: true };
	if (!existing.info) {
		// Vanished between EEXIST and read: retry the exclusive create once.
		try {
			return { acquired: await createLockExclusive(ctx) };
		} catch (retryError) {
			if (retryError instanceof CorruptLockError) return { acquired: false, corrupt: true };
			throw retryError;
		}
	}
	if (isAlive(existing.info.pid)) {
		return { acquired: false, liveHolderPid: existing.info.pid };
	}

	const tookOver = await takeoverDeadHolder(ctx, existing.info);
	if (!tookOver) {
		const recheck = await readLockWithInode(ctx.path).catch((): LockRead => ({ info: undefined, corrupt: true }));
		if (recheck.info && isAlive(recheck.info.pid)) return { acquired: false, liveHolderPid: recheck.info.pid };
		return { acquired: false, corrupt: true };
	}
	return { acquired: true, tookOverFrom: existing.info.pid };
}

/** Release the lock on graceful shutdown; only the holder may release. */
export async function releaseSingleInstanceLock(roots: DaemonRoots): Promise<boolean> {
	const ctx: LockContext = { path: lockFilePath(roots), runtimeRoot: roots.runtimeRoot };
	const existing = await readLockWithInode(ctx.path).catch((): LockRead => ({ info: undefined, corrupt: true }));
	if (!existing.info || existing.info.pid !== process.pid) return false;
	await unlink(ctx.path).catch(() => {});
	await fsyncDir(ctx.runtimeRoot);
	return true;
}