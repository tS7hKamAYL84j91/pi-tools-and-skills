/** Generic confined filesystem capability bound to one validated absolute root. */

import { constants } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import { access, chmod, lstat, mkdir, open, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { appendLogLine, writeFileAtomic } from "./file-persistence.js";
import { assertInside } from "./path-inside.js";
import {
	assertAbsolutePath,
	assertNoSymlinkPath,
	assertResolvedPathInside,
	assertRootNotSymlink,
	inspectDirectoryChain,
} from "./confined-store-security.js";

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export class ConfinedStore {
	protected constructor(private readonly root: string) {}

	static async forRoot(root: string): Promise<ConfinedStore> {
		await assertRootNotSymlink(root);
		if (!await inspectDirectoryChain(root, false)) {
			throw Object.assign(new Error(`Root does not exist: ${root}`), { code: "ENOENT" });
		}
		return new ConfinedStore(resolve(root));
	}

	static async openRoot(root: string): Promise<ConfinedStore | undefined> {
		await assertRootNotSymlink(root);
		return await inspectDirectoryChain(root, false) ? new ConfinedStore(resolve(root)) : undefined;
	}

	static async createRoot(root: string): Promise<ConfinedStore> {
		await assertRootNotSymlink(root);
		await inspectDirectoryChain(root, true);
		await chmod(root, PRIVATE_DIR_MODE);
		return new ConfinedStore(resolve(root));
	}

	static async openAuthorizedRoot(root: string, metadataPath: string): Promise<ConfinedStore | undefined> {
		if (!await inspectDirectoryChain(root, false)) return undefined;
		const store = new ConfinedStore(resolve(root));
		if (!await store.fileExists(metadataPath)) return undefined;
		const metadata = await store.fileStat(metadataPath);
		if (!metadata.isFile()) throw new Error(`External root is not authorized: ${root}`);
		return store;
	}

	static async forAuthorizedRoot(root: string, metadataPath: string): Promise<ConfinedStore> {
		const store = await ConfinedStore.openAuthorizedRoot(root, metadataPath);
		if (!store) throw new Error(`External root is not authorized: ${root}`);
		return store;
	}

	getRoot(): string {
		return this.root;
	}

	async ensurePrivateDir(path: string): Promise<void> {
		await this.guard(path);
		await mkdir(path, { recursive: true, mode: PRIVATE_DIR_MODE });
		await this.guard(path);
		const info = await lstat(path);
		if (!info.isDirectory()) throw new Error(`Path is not a directory: ${path}`);
		await chmod(path, PRIVATE_DIR_MODE);
	}

	async fileExists(path: string): Promise<boolean> {
		await this.guard(path);
		try {
			await access(path, constants.F_OK);
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
	}

	async readOptionalFile(path: string): Promise<string | undefined> {
		await this.guard(path);
		try {
			const info = await lstat(path);
			if (!info.isFile()) throw new Error(`Path is not a regular file: ${path}`);
			return await readFile(path, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
	}

	async readRequiredFile(path: string): Promise<string> {
		await this.guard(path);
		const info = await lstat(path);
		if (!info.isFile()) throw new Error(`Path is not a regular file: ${path}`);
		return readFile(path, "utf8");
	}

	async readFilePrefix(path: string, maxBytes: number): Promise<{ readonly size: number; readonly text: string }> {
		await this.guard(path);
		const info = await lstat(path);
		if (!info.isFile()) throw new Error(`Path is not a regular file: ${path}`);
		const length = Math.min(info.size, maxBytes);
		const handle = await open(path, "r");
		try {
			const buffer = Buffer.alloc(length);
			await handle.read(buffer, 0, length, 0);
			return { size: info.size, text: buffer.toString("utf8") };
		} finally {
			await handle.close();
		}
	}

	async writePrivateFileAtomic(path: string, content: string): Promise<void> {
		await this.guard(path);
		await this.assertExistingRegularFileOrMissing(path);
		await this.ensurePrivateDir(dirname(path));
		await this.guard(path);
		await writeFileAtomic(path, content, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
		await chmod(path, PRIVATE_FILE_MODE);
	}

	async appendPrivateLog(path: string, line: string): Promise<void> {
		await this.guard(path);
		await this.assertExistingRegularFileOrMissing(path);
		await this.ensurePrivateDir(dirname(path));
		await this.guard(path);
		await appendLogLine(path, line, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
		await chmod(path, PRIVATE_FILE_MODE);
	}

	async removePrivateFiles(paths: readonly string[]): Promise<void> {
		for (const path of paths) await this.guard(path);
		for (const path of paths) await rm(path, { force: true });
	}

	async readDirectory(path: string): Promise<Dirent[]> {
		await this.guard(path);
		const entries = await readdir(path, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isSymbolicLink()) throw new Error(`Refusing symlinked directory entry: ${join(path, entry.name)}`);
		}
		return entries;
	}

	async fileStat(path: string): Promise<Stats> {
		await this.guard(path);
		return stat(path);
	}

	private async assertExistingRegularFileOrMissing(path: string): Promise<void> {
		try {
			const info = await lstat(path);
			if (!info.isFile()) throw new Error(`Path is not a regular file: ${path}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}

	protected async guard(path: string): Promise<void> {
		assertAbsolutePath("target", path);
		assertInside(this.root, path);
		await assertNoSymlinkPath(path);
		await this.assertResolvedPathInside(path);
	}

	protected async assertResolvedPathInside(path: string): Promise<void> {
		await assertResolvedPathInside(this.root, path);
	}
}
