/** Confined filesystem capabilities for the TypeScript CoAS runtime. */

import { lstat, stat, statfs } from "node:fs/promises";
import type { Dirent, Stats, StatsFs } from "node:fs";
import { parse as parsePath, isAbsolute, join, resolve } from "node:path";
import { ConfinedStore as GenericConfinedStore } from "../../lib/confined-store.js";
import { pathInside } from "../../lib/path-inside.js";
import { lockRoot, scheduleLogRoot, scheduleRoot, workspaceRoot } from "./store-paths.js";
import type { CoasConfig } from "./types.js";

function assertAbsolutePath(label: string, path: string): void {
	if (!isAbsolute(path)) throw new Error(`${label} must be absolute: ${path}`);
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

/** CoAS-root-bound filesystem capability. */
export class ConfinedStore extends GenericConfinedStore {
	private constructor(root: string) {
		super(root);
	}

	static async forCoasHome(config: CoasConfig): Promise<ConfinedStore> {
		await assertRootNotSymlink(config.coasHome);
		const root = resolve(config.coasHome);
		const store = await GenericConfinedStore.openRoot(root);
		if (!store) throw Object.assign(new Error(`CoAS root does not exist: ${config.coasHome}`), { code: "ENOENT" });
		return new ConfinedStore(store.getRoot());
	}

	static async openCoasHome(config: CoasConfig): Promise<ConfinedStore | undefined> {
		await assertRootNotSymlink(config.coasHome);
		const root = resolve(config.coasHome);
		const store = await GenericConfinedStore.openRoot(root);
		return store ? new ConfinedStore(store.getRoot()) : undefined;
	}

	static async createCoasHome(config: CoasConfig): Promise<ConfinedStore> {
		await assertRootNotSymlink(config.coasHome);
		const root = resolve(config.coasHome);
		const store = await GenericConfinedStore.createRoot(root);
		return new ConfinedStore(store.getRoot());
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

	static async openExternalWorkspace(root: string): Promise<ConfinedStore | undefined> {
		try {
			const metadataPath = join(root, ".pi", "coas", "workspace.env");
			const store = await GenericConfinedStore.openAuthorizedRoot(root, metadataPath);
			return store ? new ConfinedStore(store.getRoot()) : undefined;
		} catch (error) {
			const message = (error as Error).message;
			if (message.includes("Refusing symlinked path component")) {
				throw new Error(message.replace("Refusing symlinked path component", "Refusing symlinked CoAS path component"));
			}
			throw error;
		}
	}

	static async forExternalWorkspace(root: string): Promise<ConfinedStore> {
		const store = await ConfinedStore.openExternalWorkspace(root);
		if (!store) throw new Error(`External workspace is not authorized: ${root}`);
		return store;
	}

	private static async forManagedRoot(config: CoasConfig, root: string): Promise<ConfinedStore> {
		const homeStore = await ConfinedStore.forCoasHome(config);
		await homeStore.guard(root);
		const info = await lstat(root);
		if (!info.isDirectory()) throw new Error(`CoAS root is not a directory: ${root}`);
		return new ConfinedStore(resolve(root));
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

	async fileSystemStat(path: string): Promise<StatsFs> {
		await this.guard(path);
		return statfs(path);
	}

	async fileStat(path: string): Promise<Stats> {
		await this.guard(path);
		return stat(path);
	}

	async readDirectory(path: string): Promise<Dirent[]> {
		try {
			return await super.readDirectory(path);
		} catch (error) {
			const message = (error as Error).message;
			if (message.includes("Refusing symlinked directory entry")) {
				throw new Error(message.replace("Refusing symlinked directory entry", "Refusing symlinked CoAS directory entry"));
			}
			throw error;
		}
	}

	async guard(path: string): Promise<void> {
		assertAbsolutePath("CoAS target", path);
		if (!pathInside(this.getRoot(), path)) throw new Error(`Path escapes ${this.getRoot()}: ${path}`);
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
