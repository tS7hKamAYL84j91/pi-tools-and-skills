/** File watcher helpers for pi-file-watch. */
import { existsSync, lstatSync, realpathSync, statSync, watch } from "node:fs";
import { dirname, isAbsolute, relative } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveConfiguredPath } from "./config.js";
import type { FileWatchConfig, WatchedFileDescription, WatcherRuntimeState } from "./types.js";

function isExternal(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel !== "" && (rel.startsWith("..") || isAbsolute(rel));
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
			const symlink = lstatSync(absolutePath).isSymbolicLink();
			const realPath = config.followSymlinks ? realpathSync(absolutePath) : absolutePath;
			const external = isExternal(root, realPath);
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

export function createRuntimeState(): WatcherRuntimeState {
	return { watchers: [], timers: new Map(), files: [], config: undefined, lastEventAt: undefined, eventCount: 0 };
}

export function renderStatus(config: FileWatchConfig, files: readonly WatchedFileDescription[], state: WatcherRuntimeState): string {
	return `File watch: ${files.filter((file) => file.status === "watching").length}/${config.watch.length} watching, events=${state.eventCount}`;
}

export function formatWatchList(files: readonly WatchedFileDescription[]): string {
	if (files.length === 0) return "No file watch files configured.";
	return files.map((file) => `- ${file.status}: ${file.configuredPath}${file.external ? " (external)" : ""}${file.symlink ? " (symlink)" : ""}${file.error ? ` — ${file.error}` : ""}`).join("\n");
}

interface FileChangeMetadata {
	eventType: string;
	timestamp: string;
	sizeBytes?: number;
	mtimeMs?: number;
}

function fileChangeMetadata(file: WatchedFileDescription, eventType: string): FileChangeMetadata {
	if (!file.realPath) {
		return { eventType, timestamp: new Date().toISOString() };
	}
	try {
		const stats = statSync(file.realPath);
		return { eventType, timestamp: new Date().toISOString(), sizeBytes: stats.size, mtimeMs: stats.mtimeMs };
	} catch {
		return { eventType, timestamp: new Date().toISOString() };
	}
}

export function formatChangeMessage(file: WatchedFileDescription, metadata: FileChangeMetadata): string {
	const size = metadata.sizeBytes == null ? "unknown" : String(metadata.sizeBytes);
	const modified = metadata.mtimeMs == null ? "unknown" : new Date(metadata.mtimeMs).toISOString();
	return [
		`FILE WATCH UPDATE: ${file.configuredPath}${file.external ? " (external)" : ""}`,
		`event: ${metadata.eventType}`,
		`timestamp: ${metadata.timestamp}`,
		`sizeBytes: ${size}`,
		`modified: ${modified}`,
		"content: not included; use read if needed",
	].join("\n");
}

export function stopFileWatch(state: WatcherRuntimeState): void {
	for (const timer of state.timers.values()) clearTimeout(timer);
	state.timers.clear();
	for (const watcher of state.watchers) watcher.close();
	state.watchers = [];
}

function sendFileUpdate(pi: ExtensionAPI, state: WatcherRuntimeState, file: WatchedFileDescription, eventType: string): void {
	if (!state.config || file.status !== "watching" || !file.realPath) return;
	const metadata = fileChangeMetadata(file, eventType);
	state.lastEventAt = Date.now();
	state.eventCount += 1;
	pi.sendMessage({ customType: "file-watch:update", content: formatChangeMessage(file, metadata), display: true, details: { file, metadata } }, { triggerTurn: state.config.triggerTurn });
}

function scheduleFileUpdate(pi: ExtensionAPI, state: WatcherRuntimeState, file: WatchedFileDescription, eventType: string): void {
	if (!state.config || file.status !== "watching" || !file.realPath) return;
	const existing = state.timers.get(file.realPath);
	if (existing) clearTimeout(existing);
	state.timers.set(file.realPath, setTimeout(() => {
		if (file.realPath) state.timers.delete(file.realPath);
		sendFileUpdate(pi, state, file, eventType);
	}, state.config.debounceMs));
}

export function startFileWatch(pi: ExtensionAPI, ctx: ExtensionContext, config: FileWatchConfig, state: WatcherRuntimeState): WatchedFileDescription[] {
	stopFileWatch(state);
	state.config = config;
	state.files = describeWatchedFiles(ctx.cwd, config);
	for (const file of state.files) {
		if (file.status !== "watching" || !file.realPath) continue;
		const watchedName = file.realPath.split(/[\\/]/).pop();
		state.watchers.push(watch(dirname(file.realPath), (event, filename) => {
			if (!filename || filename.toString() === watchedName) scheduleFileUpdate(pi, state, file, event);
		}));
	}
	return state.files;
}
