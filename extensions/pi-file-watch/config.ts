/**
 * pi-file-watch configuration loading.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { FileWatchConfig } from "./types.js";

const DEFAULT_CONFIG_PATH = ".pi/file-watch.json";
const DEFAULT_MAX_BYTES = 12_000;
const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_BATCH_WINDOW_MS = 120_000;

interface RawConfig {
	watch?: unknown;
	paths?: unknown;
	maxBytes?: unknown;
	debounceMs?: unknown;
	batchWindowMs?: unknown;
	triggerTurn?: unknown;
	allowExternalPaths?: unknown;
	followSymlinks?: unknown;
}

function isRecord(value: unknown): value is RawConfig {
	return typeof value === "object" && value !== null;
}

function numberOrDefault(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(value)));
}

function configuredPaths(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => typeof entry === "string" ? entry : "")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0 && !entry.includes("\0"))
		.slice(0, 32);
}

export function parseFileWatchConfig(value: unknown): FileWatchConfig {
	const raw = isRecord(value) ? value : {};
	return {
		watch: configuredPaths(raw.watch ?? raw.paths),
		maxBytes: numberOrDefault(raw.maxBytes, DEFAULT_MAX_BYTES, 512, 128_000),
		debounceMs: numberOrDefault(raw.debounceMs, DEFAULT_DEBOUNCE_MS, 50, 10_000),
		batchWindowMs: numberOrDefault(raw.batchWindowMs, DEFAULT_BATCH_WINDOW_MS, 0, 600_000),
		triggerTurn: typeof raw.triggerTurn === "boolean" ? raw.triggerTurn : true,
		allowExternalPaths: typeof raw.allowExternalPaths === "boolean" ? raw.allowExternalPaths : true,
		followSymlinks: typeof raw.followSymlinks === "boolean" ? raw.followSymlinks : true,
	};
}

export async function loadFileWatchConfig(cwd: string, configPath = DEFAULT_CONFIG_PATH): Promise<FileWatchConfig> {
	const path = resolveConfiguredPath(cwd, configPath);
	if (!existsSync(path)) return parseFileWatchConfig({});
	// Malformed configuration is intentionally surfaced instead of silently changing watched paths.
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(path, "utf8"));
	} catch (error: unknown) {
		throw error instanceof Error ? error : new Error(String(error));
	}
	return parseFileWatchConfig(parsed);
}

export function resolveConfiguredPath(cwd: string, configuredPath: string): string {
	const expanded = configuredPath === "~" ? homedir() : configuredPath.startsWith("~/") ? join(homedir(), configuredPath.slice(2)) : configuredPath;
	return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}
