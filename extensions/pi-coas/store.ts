/** Confined filesystem capabilities for the TypeScript CoAS runtime. */

import { constants } from "node:fs";
import type { Dirent, Stats, StatsFs } from "node:fs";
import { access, chmod, lstat, mkdir, open, readdir, readFile, rm, stat, statfs } from "node:fs/promises";
import { parse as parsePath, dirname, isAbsolute, join, resolve } from "node:path";
import { appendLogLine, writeFileAtomic } from "../../lib/file-persistence.js";
import { assertInside, lockRoot, scheduleLogRoot, scheduleRoot, workspaceRoot } from "./store-paths.js";
import type { CoasConfig } from "./types.js";

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

function assertAbsolutePath(label: string, path: string): void {
	if (!isAbsolute(path)) throw new Error(`${label} must be absolute: ${path}`);
}

async function inspectDirectoryChain(path: string, create: boolean): Promise<boolean> {
	assertAbsolutePath("CoAS root", path);
	const absolutePath = resolve(path);
	const filesystemRoot = parsePath(absolutePath).root;
	let current = filesystemRoot;
	for (const segment of absolutePath.slice(filesystemRoot.length).split(/[\\/]+/).filter(Boolean)) {
		current = join(current, segment);
		let info: Stats;
		try {
			info = await lstat(current);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			if (!create) return false;
			await mkdir(current, { mode: PRIVATE_DIR_MODE });
			info = await lstat(current);
		}
		if (info.isSymbolicLink()) throw new Error(`Refusing symlinked CoAS path component: ${current}`);
		if (!info.isDirectory()) throw new Error(`CoAS path component is not a directory: ${current}`);
	}
	return true;
}

async function assertRootNotSymlink(path: string): Promise<void> {
	try {
		if ((await lstat(path)).isSymbolicLink()) throw new Error(`Refusing symlinked CoAS root: ${path}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

async function assertNoSymlinkPath(path: string): Promise<void> {
	assertAbsolutePath("CoAS target", path);
	const absolutePath = resolve(path);
	const filesystemRoot = parsePath(absolutePath).root;
	let current = filesystemRoot;
	for (const segment of absolutePath.slice(filesystemRoot.length).split(/[\\/]+/).filter(Boolean)) {
		current = join(current, segment);
		try {
			const info = await lstat(current);
			if (info.isSymbolicLink()) throw new Error(`Refusing symlinked CoAS path component: ${current}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
	}
}

/** An internal filesystem capability confined to one validated absolute root. */
export class ConfinedStore {
	private constructor(private readonly root: string) {}

	static async forCoasHome(config: CoasConfig): Promise<ConfinedStore> {
		await assertRootNotSymlink(config.coasHome);
		if (!await inspectDirectoryChain(config.coasHome, false)) {
			throw Object.assign(new Error(`CoAS root does not exist: ${config.coasHome}`), { code: "ENOENT" });
		}
		return new ConfinedStore(resolve(config.coasHome));
	}

	static async openCoasHome(config: CoasConfig): Promise<ConfinedStore | undefined> {
		await assertRootNotSymlink(config.coasHome);
		return await inspectDirectoryChain(config.coasHome, false)
			? new ConfinedStore(resolve(config.coasHome))
			: undefined;
	}

	static async createCoasHome(config: CoasConfig): Promise<ConfinedStore> {
		await assertRootNotSymlink(config.coasHome);
		await inspectDirectoryChain(config.coasHome, true);
		await chmod(config.coasHome, PRIVATE_DIR_MODE);
		return new ConfinedStore(resolve(config.coasHome));
	}

	static async forScheduleRoot(config: CoasConfig): Promise<ConfinedStore> {
		return ConfinedStore.forManagedRoot(config, scheduleRoot(config));
	}

	static async forWorkspaceRoot(config: CoasConfig): Promise<ConfinedStore> {
		return ConfinedStore.forManagedRoot(config, workspaceRoot(config));
	}

	static async forScheduleLogRoot(config: CoasConfig): Promise<ConfinedStore> {
		return ConfinedStore.forManagedRoot(config, scheduleLogRoot(config));
	}

	static async forLockRoot(config: CoasConfig): Promise<ConfinedStore> {
		return ConfinedStore.forManagedRoot(config, lockRoot(config));
	}

	private static async forManagedRoot(config: CoasConfig, root: string): Promise<ConfinedStore> {
		const homeStore = await ConfinedStore.forCoasHome(config);
		await homeStore.guard(root);
		const info = await lstat(root);
		if (!info.isDirectory()) throw new Error(`CoAS root is not a directory: ${root}`);
		return new ConfinedStore(resolve(root));
	}

	static async openExternalWorkspace(root: string): Promise<ConfinedStore | undefined> {
		if (!await inspectDirectoryChain(root, false)) return undefined;
		const store = new ConfinedStore(resolve(root));
		const metadataPath = join(root, ".pi", "coas", "workspace.env");
		if (!await store.fileExists(metadataPath)) return undefined;
		const metadata = await store.fileStat(metadataPath);
		if (!metadata.isFile()) throw new Error(`External workspace is not authorized: ${root}`);
		return store;
	}

	static async forExternalWorkspace(root: string): Promise<ConfinedStore> {
		const store = await ConfinedStore.openExternalWorkspace(root);
		if (!store) throw new Error(`External workspace is not authorized: ${root}`);
		return store;
	}

	async ensurePrivateDir(path: string): Promise<void> {
		await this.guard(path);
		await mkdir(path, { recursive: true, mode: PRIVATE_DIR_MODE });
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
			return await readFile(path, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
	}

	async readRequiredFile(path: string): Promise<string> {
		await this.guard(path);
		return readFile(path, "utf8");
	}

	async readFilePrefix(path: string, maxBytes: number): Promise<{ readonly size: number; readonly text: string }> {
		const info = await this.fileStat(path);
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
		await this.ensurePrivateDir(dirname(path));
		await writeFileAtomic(path, content, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
		await chmod(path, PRIVATE_FILE_MODE);
	}

	async appendPrivateLog(path: string, line: string): Promise<void> {
		await this.guard(path);
		await this.ensurePrivateDir(dirname(path));
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
			if (entry.isSymbolicLink()) throw new Error(`Refusing symlinked CoAS directory entry: ${join(path, entry.name)}`);
		}
		return entries;
	}

	async countDirectories(path: string): Promise<number> {
		if (!await this.fileExists(path)) return 0;
		return (await this.readDirectory(path)).filter((entry) => entry.isDirectory()).length;
	}

	async newestFile(path: string, suffix: string): Promise<string | undefined> {
		if (!await this.fileExists(path)) return undefined;
		let newest: { path: string; mtimeMs: number } | undefined;
		for (const entry of await this.readDirectory(path)) {
			if (!entry.isFile() || !entry.name.endsWith(suffix)) continue;
			const fullPath = join(path, entry.name);
			const info = await this.fileStat(fullPath);
			if (!newest || info.mtimeMs > newest.mtimeMs) newest = { path: fullPath, mtimeMs: info.mtimeMs };
		}
		return newest?.path;
	}

	async fileStat(path: string): Promise<Stats> {
		await this.guard(path);
		return stat(path);
	}

	async fileSystemStat(path: string): Promise<StatsFs> {
		await this.guard(path);
		return statfs(path);
	}

	private async guard(path: string): Promise<void> {
		assertAbsolutePath("CoAS target", path);
		assertInside(this.root, path);
		await assertNoSymlinkPath(path);
	}
}

/** Bootstrap all managed runtime roots through a CoAS-home-bound capability. */
export async function ensureRuntimeDirs(config: CoasConfig): Promise<ConfinedStore> {
	const store = await ConfinedStore.createCoasHome(config);
	for (const path of [workspaceRoot(config), scheduleRoot(config), scheduleLogRoot(config), lockRoot(config)]) {
		await store.ensurePrivateDir(path);
	}
	return store;
}
