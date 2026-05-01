/**
 * Confined filesystem helpers for the TypeScript CoAS runtime.
 */

import { constants, existsSync } from "node:fs";
import { access, chmod, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
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
	return join(config.coasHome, "workspaces");
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

export async function assertNoSymlinkComponents(root: string, target: string): Promise<void> {
	assertInside(root, target);
	const relativePath = relative(resolve(root), resolve(target));
	let current = resolve(root);
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
	const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
	await writeFile(tmp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
	await chmod(tmp, 0o600).catch(() => undefined);
	await rename(tmp, path);
	await chmod(path, 0o600).catch(() => undefined);
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
