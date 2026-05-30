import { open, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout } from "node:timers/promises";

export interface AdvisoryLockOptions {
	/** Maximum number of retries before giving up. Default: 50 */
	readonly maxRetries?: number;
	/** Delay between retries in milliseconds. Default: 50 */
	readonly retryDelayMs?: number;
}

/**
 * Acquire an advisory file lock using exclusive file creation (wx flag).
 * Executes the provided function while holding the lock, then releases it.
 * Automatically retries if the lock is held by another process.
 */
export async function withAdvisoryLock<T>(
	targetPath: string,
	fn: () => Promise<T>,
	options: AdvisoryLockOptions = {},
): Promise<T> {
	const maxRetries = options.maxRetries ?? 50;
	const retryDelayMs = options.retryDelayMs ?? 50;
	const lockPath = `${targetPath}.lock`;

	await mkdir(dirname(lockPath), { recursive: true });

	let locked = false;
	for (let i = 0; i <= maxRetries; i++) {
		try {
			const file = await open(lockPath, "wx");
			await file.close();
			locked = true;
			break;
		} catch (error) {
			if (
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				(error as { code: unknown }).code === "EEXIST"
			) {
				if (i < maxRetries) {
					await setTimeout(retryDelayMs);
					continue;
				}
			}
			throw new Error(
				`Failed to acquire advisory lock at ${lockPath}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	try {
		return await fn();
	} finally {
		if (locked) {
			await rm(lockPath, { force: true }).catch(() => {});
		}
	}
}
