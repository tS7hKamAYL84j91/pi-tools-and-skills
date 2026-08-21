/** Extension-neutral lexical discovery for layered Markdown descriptors. */

import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type DeclarativeSource = "builtin" | "user" | "project";

export interface DeclarativeRoot {
	readonly source: DeclarativeSource;
	readonly root: string;
}

export interface DeclarativeDiscoveryOptions {
	readonly configPath: string;
	readonly settingsKey: string;
	readonly readSettingsKey: (key: string, path: string) => unknown;
	readonly userSettingsPath: string;
	readonly userFallbackRoot: string;
	readonly projectSettingsRelativePath: string;
	readonly projectFallbackRoot: string;
	readonly cwd: string;
	readonly roots?: readonly string[];
}

export interface DeclarativePath {
	readonly source: DeclarativeSource;
	readonly root: string;
	readonly path: string;
}

/** Returns the nearest project marker, or the original start directory. */
export function findDeclarativeProjectRoot(start: string): string {
	let directory = start;
	let parent = dirname(directory);
	while (directory !== parent) {
		if (pathExists(join(directory, "package.json")) || pathExists(join(directory, ".git"))) {
			return directory;
		}
		directory = parent;
		parent = dirname(directory);
	}
	return start;
}

/** Preserves lexical paths: no realpath, containment check, or deduplication. */
export function discoverDeclarativeRoots(
	options: DeclarativeDiscoveryOptions,
): DeclarativeRoot[] {
	const roots: DeclarativeRoot[] = [{ source: "builtin", root: dirname(options.configPath) }];
	if (options.roots !== undefined) {
		for (const root of options.roots) {
			roots.push({ source: "user", root });
		}
		return roots;
	}
	for (const root of configuredRoots(options.readSettingsKey(options.settingsKey, options.userSettingsPath), options.cwd)) {
		roots.push({ source: "user", root });
	}
	if (roots.length === 1) {
		roots.push({ source: "user", root: options.userFallbackRoot });
	}
	const projectRoot = findDeclarativeProjectRoot(options.cwd);
	const projectSettingsPath = join(projectRoot, options.projectSettingsRelativePath);
	const projectRoots = configuredRoots(
		options.readSettingsKey(options.settingsKey, projectSettingsPath),
		projectRoot,
	);
	if (projectRoots.length === 0) {
		roots.push({ source: "project", root: join(projectRoot, options.projectFallbackRoot) });
	} else {
		for (const root of projectRoots) {
			roots.push({ source: "project", root });
		}
	}
	return roots;
}

/** Enumerates only immediate Markdown entries in ECMAScript lexical order. */
export function discoverMarkdownDirectories(
	roots: readonly DeclarativeRoot[],
	directories: readonly string[],
): DeclarativePath[] {
	const paths: DeclarativePath[] = [];
	for (const root of roots) {
		for (const directory of directories) {
			const absoluteDirectory = join(root.root, directory);
			if (!pathExists(absoluteDirectory)) {
				continue;
			}
			for (const entry of readdirSync(absoluteDirectory).filter((name) => name.endsWith(".md")).sort()) {
				paths.push({ source: root.source, root: root.root, path: join(absoluteDirectory, entry) });
			}
		}
	}
	return paths;
}

/** Returns supplied fixed relative targets without probing or deduplicating them. */
export function discoverFixedTargets(
	roots: readonly DeclarativeRoot[],
	target: string,
): DeclarativePath[] {
	return roots.map((root) => ({ source: root.source, root: root.root, path: join(root.root, target) }));
}

function pathExists(path: string): boolean {
	try {
		statSync(path);
		return true;
	} catch (error: unknown) {
		if (isMissingPathError(error)) {
			return false;
		}
		throw error;
	}
}

function isMissingPathError(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function configuredRoots(value: unknown, base: string): string[] {
	if (!isRecord(value) || !Array.isArray(value.roots)) {
		return [];
	}
	return value.roots
		.filter((root): root is string => typeof root === "string" && root.trim().length > 0)
		.map((root) => expandRoot(root.trim(), base));
}

function expandRoot(root: string, cwd: string): string {
	if (root === "~") {
		return homedir();
	}
	if (root.startsWith("~/")) {
		return join(homedir(), root.slice(2));
	}
	return isAbsolute(root) ? root : resolve(cwd, root);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
