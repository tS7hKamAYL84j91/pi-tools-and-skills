import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";

const MAX_LOCK_METADATA_BYTES = 4_096;

interface LockOwner { readonly pid: number; readonly createdAt: string; readonly ownerId: string; }
interface FileIdentity { readonly dev: number; readonly ino: number; }
interface AcquiredLock { readonly status: "acquired"; readonly identity: FileIdentity; }
interface ExistingLock { readonly status: "held"; readonly identity: FileIdentity; readonly owner?: LockOwner; }
interface MissingLock { readonly status: "missing"; }
type LockCreationResult = AcquiredLock | ExistingLock | MissingLock;
type LockInspectionResult = ExistingLock | MissingLock;

export interface AdvisoryLockOptions {
	/** Maximum number of retries before giving up. Default: 50 */
	readonly maxRetries?: number;
	/** Delay between retries in milliseconds. Default: 50 */
	readonly retryDelayMs?: number;
}

/** Acquire an advisory file lock with atomically published owner metadata. */
export async function withAdvisoryLock<T>(
	targetPath: string,
	fn: () => Promise<T>,
	options: AdvisoryLockOptions = {},
): Promise<T> {
	const maxRetries = options.maxRetries ?? 50;
	const retryDelayMs = options.retryDelayMs ?? 50;
	const lockPath = `${targetPath}.lock`;
	const owner: LockOwner = {
		pid: process.pid,
		createdAt: new Date().toISOString(),
		ownerId: randomUUID(),
	};
	await mkdir(dirname(lockPath), { recursive: true });

	let retries = 0;
	let acquiredIdentity: FileIdentity | undefined;
	while (!acquiredIdentity) {
		const result = await tryCreateLock(lockPath, owner);
		if (result.status === "acquired") {
			acquiredIdentity = result.identity;
			break;
		}
		if (result.status === "missing") continue;
		if (retries >= maxRetries) {
			const diagnostic = result.owner ? ` by pid ${result.owner.pid} (owner ${result.owner.ownerId})` : "";
			throw new Error(`Failed to acquire advisory lock at ${lockPath}: lock is held${diagnostic}`);
		}
		retries += 1;
		await setTimeout(retryDelayMs);
	}

	try {
		return await fn();
	} finally {
		await releaseOwnedLock(lockPath, owner.ownerId, acquiredIdentity);
	}
}

async function tryCreateLock(lockPath: string, owner: LockOwner): Promise<LockCreationResult> {
	const tempPath = join(dirname(lockPath), `.${process.pid}.${owner.ownerId}.lock-owner.tmp`);
	const file = await open(tempPath, "wx", 0o600);
	try {
		await file.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
	} finally {
		await file.close();
	}
	try {
		await link(tempPath, lockPath);
		const stat = await lstat(tempPath);
		return { status: "acquired", identity: { dev: stat.dev, ino: stat.ino } };
	} catch (error) {
		if (hasErrorCode(error, "EEXIST")) return await inspectExistingLock(lockPath);
		throw error;
	} finally {
		await rm(tempPath, { force: true }).catch(() => {});
	}
}

async function inspectExistingLock(lockPath: string): Promise<LockInspectionResult> {
	let pathStat: Awaited<ReturnType<typeof lstat>>;
	try {
		pathStat = await lstat(lockPath);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return { status: "missing" };
		throw error;
	}
	assertSafeLockMetadata(lockPath, pathStat);

	let file: Awaited<ReturnType<typeof open>>;
	try {
		file = await open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return { status: "missing" };
		throw error;
	}
	try {
		const fileStat = await file.stat();
		assertSafeLockMetadata(lockPath, fileStat);
		if (!sameIdentity(pathStat, fileStat)) {
			throw new Error(`Unsafe advisory lock changed during inspection: ${lockPath}`);
		}
		const buffer = Buffer.alloc(MAX_LOCK_METADATA_BYTES + 1);
		const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
		if (bytesRead > MAX_LOCK_METADATA_BYTES) {
			throw new Error(`Unsafe advisory lock metadata exceeds ${MAX_LOCK_METADATA_BYTES} bytes: ${lockPath}`);
		}
		return {
			status: "held",
			identity: { dev: fileStat.dev, ino: fileStat.ino },
			owner: parseLockOwner(buffer.subarray(0, bytesRead).toString("utf8")),
		};
	} finally {
		await file.close();
	}
}

function assertSafeLockMetadata(lockPath: string, lockStat: Awaited<ReturnType<typeof lstat>>): void {
	if (lockStat.isSymbolicLink()) throw new Error(`Unsafe advisory lock path is a symlink: ${lockPath}`);
	if (!lockStat.isFile()) throw new Error(`Unsafe advisory lock path is not a regular file: ${lockPath}`);
	if (lockStat.size > MAX_LOCK_METADATA_BYTES) {
		throw new Error(`Unsafe advisory lock metadata exceeds ${MAX_LOCK_METADATA_BYTES} bytes: ${lockPath}`);
	}
}

function parseLockOwner(raw: string): LockOwner | undefined {
	try {
		const value = JSON.parse(raw) as unknown;
		if (
			typeof value !== "object" || value === null ||
			!("pid" in value) || !("createdAt" in value) || !("ownerId" in value) ||
			typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid <= 0 ||
			typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt)) ||
			typeof value.ownerId !== "string" || value.ownerId.length === 0
		) return undefined;
		return { pid: value.pid, createdAt: value.createdAt, ownerId: value.ownerId };
	} catch {
		return undefined;
	}
}

async function releaseOwnedLock(lockPath: string, ownerId: string, identity: FileIdentity): Promise<void> {
	const first = await inspectExistingLock(lockPath);
	if (first.status === "missing" || first.owner?.ownerId !== ownerId || !sameIdentity(first.identity, identity)) return;
	// Node has no unlinkat-style conditional unlink, so recheck immediately before removal.
	const current = await inspectExistingLock(lockPath);
	if (current.status === "missing" || current.owner?.ownerId !== ownerId || !sameIdentity(current.identity, identity)) return;
	await rm(lockPath);
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

function hasErrorCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
