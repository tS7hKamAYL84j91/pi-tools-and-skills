/**
 * Shared type declarations for pi-file-watch.
 */
import type { FSWatcher } from "node:fs";

export interface FileWatchConfig {
	readonly watch: readonly string[];
	readonly maxBytes: number;
	readonly debounceMs: number;
	readonly batchWindowMs: number;
	readonly triggerTurn: boolean;
	readonly allowExternalPaths: boolean;
	readonly followSymlinks: boolean;
}

export interface WatchedFileDescription {
	readonly configuredPath: string;
	readonly absolutePath: string;
	readonly realPath?: string;
	readonly exists: boolean;
	readonly status: "watching" | "missing" | "error";
	readonly error?: string;
	readonly external: boolean;
	readonly symlink: boolean;
}

export interface WatcherRuntimeState {
	watchers: FSWatcher[];
	timers: Map<string, ReturnType<typeof setTimeout>>;
	batchTimer: ReturnType<typeof setTimeout> | undefined;
	batchWindowStart: number | undefined;
	batchChanges: Map<string, { file: WatchedFileDescription; eventType: string; changeCount: number }>;
	files: WatchedFileDescription[];
	config: FileWatchConfig | undefined;
	lastEventAt: number | undefined;
	eventCount: number;
}
