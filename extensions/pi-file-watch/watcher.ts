/** File watcher helpers for pi-file-watch. */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, statSync, watch } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
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

interface FirewatchUpdate {
	path: string;
	event: string;
	hash?: string;
	byte_size?: number;
	mtime?: string;
	target?: string;
}

function mapWatchEvent(eventType: string): string {
	if (eventType === "change") {
		return "modified";
	}
	return eventType;
}

function symlinkTarget(file: WatchedFileDescription): string | undefined {
	if (!file.symlink) {
		return undefined;
	}
	try {
		return resolve(dirname(file.absolutePath), readlinkSync(file.absolutePath));
	} catch {
		return undefined;
	}
}

function fileHash(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function buildFirewatchUpdate(file: WatchedFileDescription, eventType: string): FirewatchUpdate {
	const update: FirewatchUpdate = {
		path: file.configuredPath,
		event: mapWatchEvent(eventType),
	};
	const target = symlinkTarget(file);
	if (target) {
		update.target = target;
	}
	if (!file.realPath) {
		return update;
	}
	try {
		const stats = statSync(file.realPath);
		if (!stats.isFile()) {
			return update;
		}
		update.hash = fileHash(file.realPath);
		update.byte_size = stats.size;
		update.mtime = stats.mtime.toISOString();
	} catch {
		// Deleted or unreadable files still report path/event/target only.
	}
	return update;
}

export function formatChangeMessage(update: FirewatchUpdate): string {
	const lines = [
		"firewatch_update",
		`path: ${update.path}`,
		`event: ${update.event}`,
	];
	if (update.hash) {
		lines.push(`hash: ${update.hash}`);
	}
	if (update.byte_size != null) {
		lines.push(`byte_size: ${update.byte_size}`);
	}
	if (update.mtime) {
		lines.push(`mtime: ${update.mtime}`);
	}
	if (update.target) {
		lines.push(`target: ${update.target}`);
	}
	return lines.join("\n");
}

export function stopFileWatch(state: WatcherRuntimeState): void {
	for (const timer of state.timers.values()) clearTimeout(timer);
	state.timers.clear();
	for (const watcher of state.watchers) watcher.close();
	state.watchers = [];
}

function sendFileUpdate(pi: ExtensionAPI, state: WatcherRuntimeState, file: WatchedFileDescription, eventType: string): void {
	if (!state.config || file.status !== "watching" || !file.realPath) return;
	const update = buildFirewatchUpdate(file, eventType);
	state.lastEventAt = Date.now();
	state.eventCount += 1;
	pi.sendMessage({ customType: "firewatch_update", content: formatChangeMessage(update), display: true, details: update }, { triggerTurn: state.config.triggerTurn });
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
