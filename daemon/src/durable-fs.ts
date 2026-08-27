/**
 * Durable-write primitives with the exact fsync ordering specified in
 * planning/T-819-DAEMON-DESIGN.md section 3: temp file -> fsync -> no-replace
 * rename -> parent-directory fsync. Recovery redoes validated renames and
 * sweeps stale tmp files (never truncates, never drops silently; unvalidatable
 * tmps are surfaced for audit). All directory components are validated against
 * the ADR section 6 checklist (owner/mode/type, symlink rejection) anchored at
 * the daemon state/runtime roots.
 */
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, link, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
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
 * ADR section 6 directory validation, stdlib-faithful openat emulation:
 * every component from the anchor down is lstat'd — symlinks, non-directories,
 * wrong-owner, and group/world-accessible directories are rejected
 * fail-closed. Missing components are created 0700 with a parent dir fsync.
 */
export async function ensureValidatedDir(dir: string, anchor: string): Promise<void> {
	// The anchor itself may not exist yet (fresh state root); create it once.
	await mkdir(anchor, { recursive: true, mode: 0o700 });
	const relative = dir.slice(anchor.length).replace(/^\/+/, "");
	let current = anchor;
	for (const segment of relative.split("/").filter(Boolean)) {
		const next = join(current, segment);
		try {
			const info = await lstat(next);
			if (!info.isDirectory()) throw new Error(`refusing non-directory path component: ${next}`);
			if (info.uid !== process.getuid?.()) throw new Error(`refusing directory owned by another uid: ${next}`);
			if ((info.mode & 0o077) !== 0) throw new Error(`refusing permissive directory: ${next}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				await mkdir(next, { mode: 0o700 });
				await fsyncDir(current);
			} else {
				throw error;
			}
		}
		current = next;
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
 * publish -> fsync(dir). Directory components are validated against ADR
 * section 6 (owner/mode/type, symlink rejection) before use.
 */
export async function writeDurableFileNoReplace(
	finalPath: string,
	content: string,
	mode: number = 0o600,
	anchor: string,
): Promise<{ created: boolean }> {
	await ensureValidatedDir(dirname(finalPath), anchor);
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
export async function writeDurableFileReplace(finalPath: string, content: string, mode: number = 0o600, anchor: string): Promise<void> {
	await ensureValidatedDir(dirname(finalPath), anchor);
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
 * absent, tmp a regular file), remove the ones we cannot, and fsync the
 * directory. Unvalidatable tmp files are rejected (returned, never silently
 * ignored) so the caller can audit them. Idempotent by source path.
 */
export async function sweepStaleTmp(
	dir: string,
	anchor: string,
): Promise<{ swept: string[]; rejected: string[] }> {
	const swept: string[] = [];
	const rejected: string[] = [];
	if (!await exists(dir)) return { swept, rejected };
	await ensureValidatedDir(dir, anchor);
	const tmpPattern = /^(?<final>.+)\.\d+\.[0-9a-fA-F-]{36}\.tmp$/;
	for (const entry of await readdir(dir)) {
		const match = tmpPattern.exec(entry);
		if (!match?.groups?.final) continue;
		const tmpPath = join(dir, entry);
		const finalPath = join(dir, match.groups.final);
		try {
			// lstat (never follows symlinks): a non-regular tmp is rejected + audited.
			const info = await lstat(tmpPath);
			if (!info.isFile()) {
				rejected.push(tmpPath);
				continue;
			}
			let targetExists = false;
			try {
				const targetInfo = await lstat(finalPath);
				targetExists = targetInfo.isFile();
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
			// Unvalidatable tmp: leave in place; the caller audits it.
			rejected.push(tmpPath);
		}
	}
	if (swept.length > 0) await fsyncDir(dir);
	return { swept, rejected };
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}