/** Read-only discovery for local pi session source files. */

import { homedir } from "node:os";
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

/** @public */
export const DEFAULT_PI_SESSION_SOURCE_ROOT = join(homedir(), ".pi", "agent", "sessions");

/** @public */
export interface SessionSourceCandidate {
	path: string;
	relativePath: string;
	mtimeMs: number;
	size: number;
}

function isSessionFile(name: string): boolean {
	return name.endsWith(".jsonl") || name.endsWith(".json");
}

async function walk(root: string, dir: string, out: SessionSourceCandidate[]): Promise<void> {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			await walk(root, path, out);
		} else if (entry.isFile() && isSessionFile(entry.name)) {
			const info = await stat(path);
			out.push({ path, relativePath: relative(root, path), mtimeMs: info.mtimeMs, size: info.size });
		}
	}
}

/** List recent session source files under the canonical or test override root. */
export async function listRecentSessionSources(args: { sourceRoot?: string; limit?: number } = {}): Promise<SessionSourceCandidate[]> {
	const root = resolve(args.sourceRoot ?? DEFAULT_PI_SESSION_SOURCE_ROOT);
	const info = await stat(root).catch(() => undefined);
	if (!info) return [];
	if (!info.isDirectory()) throw new Error("sourceRoot must be a directory");
	const candidates: SessionSourceCandidate[] = [];
	await walk(root, root, candidates);
	const limit = Math.max(0, Math.min(Math.trunc(args.limit ?? 20), 100));
	return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.relativePath.localeCompare(b.relativePath)).slice(0, limit);
}
