/** Confined target discovery and bounded metadata reads; no timers or host calls. */
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DEFAULT_MAX_BYTES, resolveConfiguredPath } from "./config.js";
import type { FileWatchConfig, WatchedFileDescription } from "./types.js";

export interface FirewatchUpdate {
	path: string;
	event: string;
	hash?: string;
	byte_size?: number;
	mtime?: string;
	target?: string;
	change_count?: number;
}

function isExternal(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/** Check ancestors too: a regular leaf can still be reached through a symlink. */
function hasSymlinkComponent(path: string): boolean {
	let current = path;
	while (true) {
		if (lstatSync(current).isSymbolicLink()) return true;
		const parent = dirname(current);
		if (parent === current) return false;
		current = parent;
	}
}

export function describeWatchedFiles(cwd: string, config: FileWatchConfig): WatchedFileDescription[] {
	const root = realpathSync(cwd);
	return config.watch.map((configuredPath) => {
		const absolutePath = resolveConfiguredPath(cwd, configuredPath);
		const externalByText = isExternal(root, absolutePath);
		try {
			if (!existsSync(absolutePath)) {
				return { configuredPath, absolutePath, exists: false, external: externalByText, symlink: false, status: "missing" };
			}
			const symlink = hasSymlinkComponent(absolutePath);
			const realPath = realpathSync(absolutePath);
			const external = isExternal(root, realPath);
			if (symlink && !config.followSymlinks) {
				return { configuredPath, absolutePath, realPath, exists: true, external, symlink, status: "error", error: "symlink path not allowed by config" };
			}
			if (!statSync(realPath).isFile()) {
				return { configuredPath, absolutePath, realPath, exists: true, external, symlink, status: "error", error: "not a regular file" };
			}
			if (external && !config.allowExternalPaths) {
				return { configuredPath, absolutePath, realPath, exists: true, external, symlink, status: "error", error: "external path not allowed by config" };
			}
			return { configuredPath, absolutePath, realPath, exists: true, external, symlink, status: "watching" };
		} catch (error) {
			return { configuredPath, absolutePath, exists: false, external: externalByText, symlink: false, status: "error", error: error instanceof Error ? error.message : String(error) };
		}
	});
}

function symlinkTarget(file: WatchedFileDescription): string | undefined {
	if (!file.symlink) return undefined;
	try {
		return resolve(dirname(file.absolutePath), readlinkSync(file.absolutePath));
	} catch {
		return undefined;
	}
}

/** Revalidate cached paths before every read; a replacement requires rediscovery. */
function unchangedTarget(file: WatchedFileDescription): boolean {
	return file.realPath !== undefined && realpathSync(file.absolutePath) === file.realPath &&
		realpathSync(file.realPath) === file.realPath && (file.symlink || !hasSymlinkComponent(file.absolutePath));
}

function fileHash(file: WatchedFileDescription, maxBytes: number): string | undefined {
	if (!file.realPath) return undefined;
	const fd = openSync(file.realPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const before = fstatSync(fd);
		const current = lstatSync(file.realPath);
		if (!before.isFile() || before.size > maxBytes || before.dev !== current.dev || before.ino !== current.ino || !unchangedTarget(file)) return undefined;
		// One extra byte detects growth without ever reading an unbounded file.
		const buffer = Buffer.alloc(maxBytes + 1);
		let used = 0;
		while (used < buffer.length) {
			const count = readSync(fd, buffer, used, buffer.length - used, used);
			if (count === 0) break;
			used += count;
		}
		const after = fstatSync(fd);
		if (used > maxBytes || used !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) return undefined;
		return createHash("sha256").update(buffer.subarray(0, used)).digest("hex");
	} finally {
		closeSync(fd);
	}
}

export function buildFirewatchUpdate(file: WatchedFileDescription, eventType: string, maxBytes = DEFAULT_MAX_BYTES): FirewatchUpdate {
	const update: FirewatchUpdate = {
		path: file.configuredPath,
		event: eventType === "change" ? "modified" : eventType,
	};
	if (file.status !== "watching") return update;
	const target = symlinkTarget(file);
	if (target) update.target = target;
	if (!file.realPath) return update;
	try {
		if (!unchangedTarget(file)) return update;
		const stats = statSync(file.realPath);
		if (!stats.isFile()) return update;
		update.byte_size = stats.size;
		update.mtime = stats.mtime.toISOString();
		const limit = Number.isFinite(maxBytes) ? Math.max(0, Math.min(128_000, Math.floor(maxBytes))) : DEFAULT_MAX_BYTES;
		if (stats.size <= limit) update.hash = fileHash(file, limit);
	} catch {
		// Deleted or unreadable files still report path/event/target only.
	}
	return update;
}
