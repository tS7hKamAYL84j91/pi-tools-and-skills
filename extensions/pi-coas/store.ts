/**
 * Confined filesystem helpers for the TypeScript CoAS runtime.
 */
import { constants, existsSync } from "node:fs";
import type { Dirent } from "node:fs";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { access, chmod, lstat, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { CoasConfig } from "./types.js";
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export function isoUtc(date = new Date()): string {
	return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
export function slugify(value: string, fallback = "workspace"): string {
	const slug = value.trim().toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[-._]+|[-._]+$/g, "");
	return slug || fallback;
}
export function workspaceIdFromRoom(room: string): string {
	return `room-${slugify(room)}`;
}
export function assertSafeId(label: string, value: string): void {
	if (!SAFE_ID_PATTERN.test(value) || value.includes("..")) {
		throw new Error(`Invalid ${label}: ${value}`);
	}
}
export function workspaceRoot(config: CoasConfig): string {
	return join(config.coasHome, "workspace");
}
export function scheduleRoot(config: CoasConfig): string {
	return join(config.coasHome, "schedules");
}
export function logRoot(config: CoasConfig): string {
	return join(config.coasHome, "logs");
}
export function scheduleLogRoot(config: CoasConfig): string {
	return join(logRoot(config), "schedules");
}
export function lockRoot(config: CoasConfig): string {
	return join(config.coasHome, "locks", "schedules");
}
export function pathInside(parent: string, child: string): boolean {
	const parentReal = resolve(parent);
	const childReal = resolve(child);
	const pathFromParent = relative(parentReal, childReal);
	return pathFromParent === "" || (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent));
}
export function assertInside(parent: string, child: string): void {
	if (!pathInside(parent, child)) {
		throw new Error(`Path escapes ${parent}: ${child}`);
	}
}
function assertAbsolutePath(label: string, path: string): void {
	if (!isAbsolute(path)) {
		throw new Error(`${label} must be absolute: ${path}`);
	}
}
export async function assertNoSymlinkComponents(root: string, target: string): Promise<void> {
	assertAbsolutePath("CoAS root", root);
	assertAbsolutePath("CoAS target", target);
	assertInside(root, target);
	let current = resolve(root);
	try {
		const info = await lstat(current);
		if (info.isSymbolicLink()) throw new Error(`Refusing symlinked CoAS path component: ${current}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	const relativePath = relative(current, resolve(target));
	for (const part of relativePath.split(/[\\/]+/).filter((segment) => segment.length > 0)) {
		current = join(current, part);
		try {
			const info = await lstat(current);
			if (info.isSymbolicLink()) throw new Error(`Refusing symlinked CoAS path component: ${current}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
	}
}
async function assertExistingDirectory(root: string): Promise<void> {
	assertAbsolutePath("CoAS root", root);
	const info = await lstat(root);
	if (info.isSymbolicLink()) throw new Error(`Refusing symlinked CoAS root: ${root}`);
	if (!info.isDirectory()) throw new Error(`CoAS root is not a directory: ${root}`);
}
/** An internal filesystem capability confined to one validated root. */
export class ConfinedStore {
	private constructor(private readonly root: string) {}
	static async forCoasHome(config: CoasConfig): Promise<ConfinedStore> {
		await assertExistingDirectory(config.coasHome);
		return new ConfinedStore(config.coasHome);
	}
	static async forScheduleRoot(config: CoasConfig): Promise<ConfinedStore> {
		return ConfinedStore.createManagedStore(config, scheduleRoot(config));
	}
	static async forWorkspaceRoot(config: CoasConfig): Promise<ConfinedStore> {
		return ConfinedStore.createManagedStore(config, workspaceRoot(config));
	}
	private static async createManagedStore(config: CoasConfig, root: string): Promise<ConfinedStore> {
		await assertExistingDirectory(config.coasHome);
		assertAbsolutePath("CoAS managed root", root);
		assertInside(config.coasHome, root);
		await assertNoSymlinkComponents(config.coasHome, root);
		await assertExistingDirectory(root);
		return new ConfinedStore(root);
	}
	// workspace-paths imports this module, so this owns the metadata boundary
	// until authorization moves to a shared lower-level module in phase 2.
	static async forExternalWorkspace(root: string): Promise<ConfinedStore> {
		await assertExistingDirectory(root);
		const metadataPath = join(root, ".pi", "coas", "workspace.env");
		await assertNoSymlinkComponents(root, metadataPath);
		const metadata = await lstat(metadataPath).catch((error: unknown) => {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`External workspace is not authorized: ${root}`);
			throw error;
		});
		if (!metadata.isFile()) throw new Error(`External workspace is not authorized: ${root}`);
		return new ConfinedStore(root);
	}
	async ensurePrivateDir(path: string): Promise<void> {
		await this.guard(path);
		await mkdir(path, { recursive: true, mode: 0o700 });
		await chmod(path, 0o700).catch(() => undefined);
	}
	async fileExists(path: string): Promise<boolean> {
		await this.guard(path);
		try {
			await access(path, constants.F_OK);
			return true;
		} catch {
			return false;
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
	async writePrivateFileAtomic(path: string, content: string): Promise<void> {
		await this.guard(path);
		await this.ensurePrivateDir(dirname(path));
		await writeFileAtomic(path, content, { encoding: "utf8", mode: 0o600 });
	}
	async removePrivateFiles(paths: string[]): Promise<void> {
		for (const path of paths) {
			await this.guard(path);
		}
		for (const path of paths) {
			await rm(path, { force: true });
		}
	}
	async countDirectories(path: string): Promise<number> {
		await this.guard(path);
		if (!existsSync(path)) return 0;
		const entries = await readdir(path, { withFileTypes: true });
		this.assertNoSymlinkEntries(path, entries);
		return entries.filter((entry) => entry.isDirectory()).length;
	}
	async newestFile(path: string, suffix: string): Promise<string | undefined> {
		await this.guard(path);
		if (!existsSync(path)) return undefined;
		const entries = await readdir(path, { withFileTypes: true });
		this.assertNoSymlinkEntries(path, entries);
		let newest: { path: string; mtimeMs: number } | undefined;
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(suffix)) continue;
			const fullPath = join(path, entry.name);
			await this.guard(fullPath);
			const info = await stat(fullPath);
			if (!newest || info.mtimeMs > newest.mtimeMs) newest = { path: fullPath, mtimeMs: info.mtimeMs };
		}
		return newest?.path;
	}
	private async guard(path: string): Promise<void> {
		assertAbsolutePath("CoAS target", path);
		await assertNoSymlinkComponents(this.root, path);
	}
	private assertNoSymlinkEntries(path: string, entries: Dirent[]): void {
		for (const entry of entries) {
			if (entry.isSymbolicLink()) throw new Error(`Refusing symlinked CoAS directory entry: ${join(path, entry.name)}`);
		}
	}
}
export async function ensurePrivateDir(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	await chmod(path, 0o700).catch(() => undefined);
}
export async function ensureRuntimeDirs(config: CoasConfig): Promise<void> {
	await ensurePrivateDir(config.coasHome);
	await ensurePrivateDir(workspaceRoot(config));
	await ensurePrivateDir(scheduleRoot(config));
	await ensurePrivateDir(scheduleLogRoot(config));
	await ensurePrivateDir(lockRoot(config));
}
export async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}
export async function readOptionalFile(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}
export async function writePrivateFileAtomic(path: string, content: string): Promise<void> {
	await ensurePrivateDir(dirname(path));
	await writeFileAtomic(path, content, { encoding: "utf8", mode: 0o600 });
}
export async function removePrivateFiles(paths: string[]): Promise<void> {
	for (const path of paths) {
		await rm(path, { force: true });
	}
}
export async function countDirectories(path: string): Promise<number> {
	if (!existsSync(path)) return 0;
	const entries = await readdir(path, { withFileTypes: true });
	return entries.filter((entry) => entry.isDirectory()).length;
}
export async function newestFile(path: string, suffix: string): Promise<string | undefined> {
	if (!existsSync(path)) return undefined;
	const entries = await readdir(path, { withFileTypes: true });
	let newest: { path: string; mtimeMs: number } | undefined;
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(suffix)) continue;
		const fullPath = join(path, entry.name);
		const info = await stat(fullPath);
		if (!newest || info.mtimeMs > newest.mtimeMs) newest = { path: fullPath, mtimeMs: info.mtimeMs };
	}
	return newest?.path;
}
function shellQuote(value: string): string {
	if (/^[A-Za-z0-9_@%+=:,./-]*$/.test(value) && value.length > 0) return value;
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}
function unquoteShellValue(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
		return trimmed.slice(1, -1).replace(/'"'"'/g, "'");
	}
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.slice(1, -1).replace(/\\"/g, '"');
	}
	return trimmed;
}
export function parseEnv(content: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const index = trimmed.indexOf("=");
		if (index <= 0) continue;
		const key = trimmed.slice(0, index);
		if (!/^[A-Z0-9_]+$/.test(key)) continue;
		values[key] = unquoteShellValue(trimmed.slice(index + 1));
	}
	return values;
}
export function formatEnv(values: Record<string, string>): string {
	return `${Object.entries(values).map(([key, value]) => `${key}=${shellQuote(value)}`).join("\n")}\n`;
}
