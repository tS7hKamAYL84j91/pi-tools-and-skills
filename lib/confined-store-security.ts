/** Native filesystem validation for confined stores. */

import type { Stats } from "node:fs";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { parse as parsePath, dirname, isAbsolute, join, resolve } from "node:path";
import { assertInside } from "./path-inside.js";

const PRIVATE_DIR_MODE = 0o700;

export function assertAbsolutePath(label: string, path: string): void {
	if (!isAbsolute(path)) throw new Error(`${label} must be absolute: ${path}`);
}

export async function inspectDirectoryChain(path: string, create: boolean): Promise<boolean> {
	assertAbsolutePath("root", path);
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
		if (info.isSymbolicLink()) throw new Error(`Refusing symlinked path component: ${current}`);
		if (!info.isDirectory()) throw new Error(`Path component is not a directory: ${current}`);
	}
	return true;
}

export async function assertRootNotSymlink(path: string): Promise<void> {
	try {
		if ((await lstat(path)).isSymbolicLink()) throw new Error(`Refusing symlinked root: ${path}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

export async function assertNoSymlinkPath(path: string): Promise<void> {
	assertAbsolutePath("target", path);
	const absolutePath = resolve(path);
	const filesystemRoot = parsePath(absolutePath).root;
	let current = filesystemRoot;
	for (const segment of absolutePath.slice(filesystemRoot.length).split(/[\\/]+/).filter(Boolean)) {
		current = join(current, segment);
		try {
			const info = await lstat(current);
			if (info.isSymbolicLink()) throw new Error(`Refusing symlinked path component: ${current}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
	}
}

export async function assertResolvedPathInside(root: string, path: string): Promise<void> {
	let candidate = resolve(path);
	while (true) {
		try {
			const [resolvedRoot, resolvedCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
			assertInside(resolvedRoot, resolvedCandidate);
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const parent = dirname(candidate);
			if (parent === candidate) throw error;
			candidate = parent;
		}
	}
}
