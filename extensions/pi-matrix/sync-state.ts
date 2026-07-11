/**
 * Persistent Matrix sync-token storage.
 *
 * Uses atomic temp-file + rename writes via the shared writeFileAtomic helper,
 * private-local permissions, and rejects symlinked paths to prevent writes to
 * unexpected locations. A quarantine path is used for corrupt state so a restart
 * can recover without looping on a bad token.
 */

import { lstat, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import type { SyncStateStore } from "./adapter.js";

interface FileSyncStateOptions {
	storagePath: string;
	filename?: string;
}

const SYNC_FILENAME = "sync.json";
const QUARANTINE_FILENAME = "sync.corrupt.json";

export class FileSyncStateStore implements SyncStateStore {
	private readonly syncFile: string;
	private readonly quarantineFile: string;

	constructor(options: FileSyncStateOptions) {
		this.syncFile = join(options.storagePath, options.filename ?? SYNC_FILENAME);
		this.quarantineFile = join(options.storagePath, QUARANTINE_FILENAME);
	}

	async load(): Promise<string | null> {
		await this.rejectSymlink(this.syncFile);
		try {
			const text = await readFile(this.syncFile, "utf-8");
			const parsed = JSON.parse(text);
			if (typeof parsed.nextBatch !== "string" || parsed.nextBatch.length === 0) {
				throw new Error("sync state missing nextBatch token");
			}
			return parsed.nextBatch;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			await this.quarantine();
			return null;
		}
	}

	async save(token: string): Promise<void> {
		await this.rejectSymlink(this.syncFile);
		await writeFileAtomic(this.syncFile, JSON.stringify({ nextBatch: token }), { mode: 0o600 });
	}

	async reset(): Promise<void> {
		await this.rejectSymlink(this.syncFile);
		try {
			await unlink(this.syncFile);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
				throw err;
			}
		}
	}

	private async quarantine(): Promise<void> {
		try {
			await rename(this.syncFile, this.quarantineFile);
		} catch {
			/* ignore — state may already be missing */
		}
	}

	private async rejectSymlink(path: string): Promise<void> {
		const info = await lstat(path).catch(() => null);
		if (info?.isSymbolicLink()) {
			throw new Error(`sync state path ${path} is a symlink; refusing to read/write`);
		}
	}
}
