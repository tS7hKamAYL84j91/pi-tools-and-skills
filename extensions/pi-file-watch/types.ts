/**
 * Shared type declarations for pi-file-watch.
 */
/** Minimal handle returned by a directory watch. Only `close()` is used. */
export interface WatchHandle {
	close(): void;
}

/** Factory that starts watching a directory, mirroring `fs.watch`'s callback form. */
export type WatchFactory = (path: string, callback: (event: string, filename: string | Buffer | null) => void) => WatchHandle;

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
	watchers: WatchHandle[];
	watchFactory?: WatchFactory;
	timers: Map<string, ReturnType<typeof setTimeout>>;
	batchTimer: ReturnType<typeof setTimeout> | undefined;
	batchWindowStart: number | undefined;
	batchChanges: Map<string, { file: WatchedFileDescription; eventType: string; changeCount: number }>;
	files: WatchedFileDescription[];
	config: FileWatchConfig | undefined;
	lastEventAt: number | undefined;
	eventCount: number;
}
