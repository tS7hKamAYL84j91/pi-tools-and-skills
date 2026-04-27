/**
 * Pi Cheatsheets Discovery — path helpers, settings reader, file discovery.
 *
 * Discovers .mmem.yml files from settings.json paths, ~/.pi/agent/memories/,
 * and .pi/memories/. Returns raw parsed MemoryFile objects ready for validation
 * or injection.
 *
 * Uses readFileSync (not require) for settings.json — synchronous is fine at
 * session startup and avoids module-graph side effects.
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { readPiSettingsKey } from "../../lib/pi-settings.js";
import { MMEM_EXT, type MemoryFile, type MemorySource } from "./types.js";
import { parseMemoryContent } from "./parse.js";

// ── Path helpers ─────────────────────────────────────────────────

/** ~/.pi/agent/memories/ */
export function piGlobalDir(): string {
	return join(homedir(), ".pi", "agent", "memories");
}

/** .pi/memories/ in project */
export function piProjectDir(cwd: string): string {
	return join(cwd, ".pi", "memories");
}

/** Deprecated: ~/.mmem/ */
function legacyGlobalDir(): string {
	return process.env.MMEM_DIR ?? join(homedir(), ".mmem");
}

/** Deprecated: .mmem/ in project */
function legacyProjectDir(cwd: string): string {
	return join(cwd, ".mmem");
}

/** Read "memories" paths from ~/.pi/agent/settings.json. */
function readSettingsMemoryPaths(): string[] {
	const value = readPiSettingsKey("memories");
	if (!Array.isArray(value)) return [];
	return value.filter((p): p is string => typeof p === "string" && existsSync(p));
}

/** Build the filename for a memory in a given directory. */
export function memoryFilePath(dir: string, name: string): string {
	return join(dir, `${name}${MMEM_EXT}`);
}

// ── File-level loading ───────────────────────────────────────────

/** List all .mmem.yml files in a directory. */
function listMemoryFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	try {
		return readdirSync(dir)
			.filter((f) => f.endsWith(MMEM_EXT))
			.map((f) => join(dir, f))
			.sort();
	} catch {
		return [];
	}
}

/** Load a single .mmem.yml file. */
async function loadMemoryFile(path: string, source: MemorySource): Promise<MemoryFile | null> {
	try {
		const { readFile } = await import("node:fs/promises");
		const raw = await readFile(path, "utf-8");
		const fallbackName = basename(path, MMEM_EXT);
		const parsed = parseMemoryContent(raw, fallbackName);
		if (!parsed) return null;
		return { ...parsed, path, source };
	} catch {
		return null;
	}
}

/** Load all memories from a directory with a given source label. */
async function loadDir(dir: string, source: MemorySource, into: Map<string, MemoryFile>): Promise<void> {
	for (const path of listMemoryFiles(dir)) {
		const mem = await loadMemoryFile(path, source);
		if (mem) into.set(mem.name, mem);
	}
}

// ── Discovery ───────────────────────────────────────────────────

/**
 * Discover all memory files. Later sources override earlier for the same name.
 *
 * Order (lowest → highest priority):
 *   1. Deprecated ~/.mmem/
 *   2. Deprecated .mmem/
 *   3. settings.json "memories" paths
 *   4. ~/.pi/agent/memories/
 *   5. .pi/memories/                  (highest — project-local override)
 */
export async function discoverMemories(cwd: string): Promise<Map<string, MemoryFile>> {
	const memories = new Map<string, MemoryFile>();

	// 1. Deprecated global (~/.mmem/)
	await loadDir(legacyGlobalDir(), "deprecated-global", memories);

	// 2. Deprecated project-local (.mmem/)
	await loadDir(legacyProjectDir(cwd), "deprecated-project", memories);

	// 3. settings.json "memories" paths
	for (const dir of readSettingsMemoryPaths()) {
		await loadDir(dir, "settings", memories);
	}

	// 4. Pi global (~/.pi/agent/memories/)
	await loadDir(piGlobalDir(), "global", memories);

	// 5. Pi project-local (.pi/memories/) — highest priority
	await loadDir(piProjectDir(cwd), "project", memories);

	return memories;
}

/**
 * Get all memory directories in discovery order (for display/diagnostics).
 */
export function getMemoryDirs(cwd: string): { dir: string; source: MemorySource; exists: boolean }[] {
	const dirs: { dir: string; source: MemorySource; exists: boolean }[] = [];

	const legacyG = legacyGlobalDir();
	if (existsSync(legacyG)) dirs.push({ dir: legacyG, source: "deprecated-global", exists: true });

	const legacyP = legacyProjectDir(cwd);
	if (existsSync(legacyP)) dirs.push({ dir: legacyP, source: "deprecated-project", exists: true });

	for (const dir of readSettingsMemoryPaths()) {
		dirs.push({ dir, source: "settings", exists: existsSync(dir) });
	}

	dirs.push({ dir: piGlobalDir(), source: "global", exists: existsSync(piGlobalDir()) });
	dirs.push({ dir: piProjectDir(cwd), source: "project", exists: existsSync(piProjectDir(cwd)) });

	return dirs;
}