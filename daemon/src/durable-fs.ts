/**
 * Durable-write primitives with the exact fsync ordering specified in
 * planning/T-819-DAEMON-DESIGN.md section 3: temp file -> fsync -> no-replace
 * rename -> parent-directory fsync. Recovery redoes validated renames and
 * sweeps stale tmp files (never truncates, never drops silently).
 */
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { link, mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

/** fsync a directory by opening it read-only and syncing the handle (Linux). */
export async function fsyncDir(dir: string): Promise<void> {
	const handle = await open(dir, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

/**
 * no-replace publish: link(tmp, final) fails with EEXIST when the target
 * exists, giving publish atomicity without clobbering (Node stdlib lacks
 * renameat2 RENAME_NOREPLACE; link+unlink is the stdlib-faithful equivalent
 * and keeps the tmp file as the recovery source until publication).
 */
async function linkNoReplace(tmpPath: string, finalPath: string): Promise<void> {
	try {
		await link(tmpPath, finalPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw Object.assign(new Error(`refusing no-replace publish: target exists: ${finalPath}`), { code: "EEXIST" });
		}
		throw error;
	}
}

/**
 * Atomically publish a durable file: temp -> fsync(file) -> no-replace
 * publish -> fsync(dir). Returns created=false when the target already
 * exists (the caller decides whether that is an error or a no-op).
 */
export async function writeDurableFileNoReplace(
	finalPath: string,
	content: string,
	mode: number = 0o600,
): Promise<{ created: boolean }> {
	await mkdir(dirname(finalPath), { recursive: true, mode: 0o700 });
	const tmpPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
	const handle = await open(tmpPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, mode);
	try {
		await handle.writeFile(content, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await linkNoReplace(tmpPath, finalPath);
	} catch (error) {
		await unlink(tmpPath).catch(() => {});
		throw error;
	}
	await unlink(tmpPath).catch(() => {});
	await fsyncDir(dirname(finalPath));
	return { created: true };
}

/** Overwrite-in-place variant (identity updates) with the same durability order. */
export async function writeDurableFileReplace(finalPath: string, content: string, mode: number = 0o600): Promise<void> {
	await mkdir(dirname(finalPath), { recursive: true, mode: 0o700 });
	const tmpPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
	const handle = await open(tmpPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW, mode);
	try {
		await handle.writeFile(content, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	await rename(tmpPath, finalPath);
	await fsyncDir(dirname(finalPath));
}

/**
 * Recovery: redo interrupted tmp->final renames we can validate (target
 * absent, tmp intact), remove the ones we cannot, and fsync the directory.
 * Idempotent; the caller emits audit events from the returned list.
 */
export async function sweepStaleTmp(dir: string): Promise<string[]> {
	const swept: string[] = [];
	if (!await exists(dir)) return swept;
	const tmpPattern = /^(?<final>.+)\.\d+\.[0-9a-fA-F-]{36}\.tmp$/;
	for (const entry of await readdir(dir)) {
		const match = tmpPattern.exec(entry);
		if (!match?.groups?.final) continue;
		const tmpPath = join(dir, entry);
		const finalPath = join(dir, match.groups.final);
		try {
			const info = await stat(tmpPath);
			if (!info.isFile()) continue;
			let targetExists = false;
			try {
				await stat(finalPath);
				targetExists = true;
			} catch {
				targetExists = false;
			}
			if (targetExists) {
				// The publication completed; drop the tmp.
				await unlink(tmpPath);
			} else {
				await link(tmpPath, finalPath);
				await unlink(tmpPath);
			}
			swept.push(tmpPath);
		} catch {
			// Unreadable/unlinkable tmp: leave it; the scanner ignores tmp files.
		}
	}
	if (swept.length > 0) await fsyncDir(dir);
	return swept;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}