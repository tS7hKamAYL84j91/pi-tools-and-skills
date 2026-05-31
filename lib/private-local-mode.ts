/** Metadata-only private local path hardening helpers. */

import { chmodSync, closeSync, constants, lstatSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, parse } from "node:path";

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

export interface PrivatePathAudit {
	path: string;
	exists: boolean;
	ok: boolean;
	kind: "directory" | "file" | "missing" | "other";
	mode?: number;
	error?: string;
}

function modeOf(path: string): number | undefined {
	try {
		return lstatSync(path).mode & 0o777;
	} catch {
		return undefined;
	}
}

function assertNoSymlinkPathComponents(path: string): void {
	const root = parse(path).root;
	let current = isAbsolute(path) ? root : ".";
	const relative = isAbsolute(path) ? path.slice(root.length) : path;
	for (const segment of relative.split(/[\\/]+/).filter(Boolean)) {
		current = current === root ? `${root}${segment}` : `${current}/${segment}`;
		try {
			if (lstatSync(current).isSymbolicLink()) throw new Error(`private local path component is a symlink: ${current}`);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
			throw err;
		}
	}
}

function ensurePrivateDirectoryChain(path: string): void {
	assertNoSymlinkPathComponents(path);
	const root = parse(path).root;
	let current = isAbsolute(path) ? root : ".";
	const relative = isAbsolute(path) ? path.slice(root.length) : path;
	for (const segment of relative.split(/[\\/]+/).filter(Boolean)) {
		current = current === root ? `${root}${segment}` : `${current}/${segment}`;
		try {
			const stat = lstatSync(current);
			if (stat.isSymbolicLink()) throw new Error(`private local path component is a symlink: ${current}`);
			if (!stat.isDirectory()) throw new Error(`private local path component is not a directory: ${current}`);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
			mkdirSync(current, { mode: PRIVATE_DIR_MODE });
		}
	}
}

export function auditPrivateDirectory(path: string): PrivatePathAudit {
	try {
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) {
			return { path, exists: true, ok: false, kind: "other", mode: modeOf(path), error: "path must not be a symlink" };
		}
		if (!stat.isDirectory()) {
			return { path, exists: true, ok: false, kind: "other", mode: modeOf(path), error: "path must be a directory" };
		}
		const mode = stat.mode & 0o777;
		return { path, exists: true, ok: mode === PRIVATE_DIR_MODE, kind: "directory", mode, ...(mode === PRIVATE_DIR_MODE ? {} : { error: "directory mode must be 0700" }) };
	} catch {
		return { path, exists: false, ok: false, kind: "missing" };
	}
}

export function auditPrivateFile(path: string): PrivatePathAudit {
	try {
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) {
			return { path, exists: true, ok: false, kind: "other", mode: modeOf(path), error: "path must not be a symlink" };
		}
		if (!stat.isFile()) {
			return { path, exists: true, ok: false, kind: "other", mode: modeOf(path), error: "path must be a file" };
		}
		const mode = stat.mode & 0o777;
		return { path, exists: true, ok: mode === PRIVATE_FILE_MODE, kind: "file", mode, ...(mode === PRIVATE_FILE_MODE ? {} : { error: "file mode must be 0600" }) };
	} catch {
		return { path, exists: false, ok: false, kind: "missing" };
	}
}

export function ensurePrivateDirectory(path: string): void {
	ensurePrivateDirectoryChain(path);
	const stat = lstatSync(path);
	if (stat.isSymbolicLink()) throw new Error(`private local path is a symlink: ${path}`);
	if (!stat.isDirectory()) throw new Error(`private local path is not a directory: ${path}`);
	chmodSync(path, PRIVATE_DIR_MODE);
}

export function assertPrivateFileForRead(path: string): void {
	assertNoSymlinkPathComponents(dirname(path));
	const audit = auditPrivateFile(path);
	if (!audit.ok) throw new Error(audit.error ?? `private file check failed: ${path}`);
}

export function assertPrivateFileTarget(path: string): void {
	assertNoSymlinkPathComponents(dirname(path));
	try {
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) throw new Error(`private local file is a symlink: ${path}`);
		if (!stat.isFile()) throw new Error(`private local path is not a file: ${path}`);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
		throw err;
	}
}

export function setPrivateFileMode(path: string): void {
	assertNoSymlinkPathComponents(dirname(path));
	const stat = lstatSync(path);
	if (stat.isSymbolicLink()) throw new Error(`private local file is a symlink: ${path}`);
	if (!stat.isFile()) throw new Error(`private local path is not a file: ${path}`);
	chmodSync(path, PRIVATE_FILE_MODE);
}

export function writeNewPrivateFileSync(path: string, data: string): void {
	assertNoSymlinkPathComponents(dirname(path));
	const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, PRIVATE_FILE_MODE);
	try {
		writeFileSync(fd, data, { encoding: "utf-8" });
	} finally {
		closeSync(fd);
	}
}
