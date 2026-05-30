/** Shared helpers for architecture fitness tests. */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function listFiles(root: string, extensions: string[]): string[] {
	const files: string[] = [];
	if (!existsSync(root)) return files;
	for (const entry of readdirSync(root)) {
		const path = join(root, entry);
		if (statSync(path).isDirectory()) {
			files.push(...listFiles(path, extensions));
		} else if (extensions.some((extension) => path.endsWith(extension))) {
			files.push(path);
		}
	}
	return files;
}

export function listTsFiles(root: string): string[] {
	return listFiles(root, [".ts"]);
}

export function extensionNames(): string[] {
	return readdirSync("extensions").filter((name) =>
		statSync(join("extensions", name)).isDirectory(),
	);
}

export function sourceFiles(): string[] {
	return [...listTsFiles("extensions"), ...listTsFiles("lib")];
}

export function stringLiteralMatches(content: string, pattern: RegExp): string[] {
	return [...content.matchAll(pattern)].map((match) => match[1] ?? "").filter(Boolean);
}

export function localImportSpecifiers(content: string): string[] {
	const importPattern =
		/from\s+["'](\.\.?\/[^"']+)["']|import\s+["'](\.\.?\/[^"']+)["']|import\s*\([^)]*["'](\.\.?\/[^"']+)["'][^)]*\)/g;
	return [...content.matchAll(importPattern)].map(
		(match) => match[1] ?? match[2] ?? match[3] ?? "",
	).filter(Boolean);
}
