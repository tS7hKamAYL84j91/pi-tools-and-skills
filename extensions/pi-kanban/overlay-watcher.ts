/**
 * Kanban overlay board.log watcher: debounced live refresh with selection
 * capture at event time. Owns the FSWatcher, debounce timer, and live flag
 * so the controller stays free of watcher plumbing.
 *
 * `live` is truthful: it is true only while the watch stream is healthy AND
 * the most recent parse succeeded. Parse failures mark the view stale; a
 * later successful parse recovers. An empty parse is re-read once before it
 * is accepted as a confirmed empty board, so a truncate-then-write rewrite
 * (compaction) is never mistaken for an emptied board.
 */

import { watch } from "node:fs";
import { type BoardState, boardLogPath, parseBoard } from "./board.js";

const DEBOUNCE_MS = 150;
const EMPTY_RECHECK_MS = 100;
const RESTART_DELAY_MS = 1_000;

/** Minimal handle the watcher needs from a directory watch. */
export interface BoardWatchHandle {
	close(): void;
	unref?(): void;
	on?(event: "error", listener: (error: Error) => void): void;
}

/** Factory that starts watching a directory, mirroring `fs.watch`'s callback form. */
export type BoardWatchFactory = (
	path: string,
	callback: (event: string, filename: string | Buffer | null) => void,
) => BoardWatchHandle;

interface BoardLogWatcherCallbacks {
	/** Selection identity captured when the file event fires. */
	captureSelection(): string | undefined;
	/** A populated board parsed after the debounce, or a confirmed empty board. */
	onBoard(board: BoardState, selectedId: string | undefined): void;
	/** Live refresh ended (watch error, failed start, or parse failure). */
	onUnavailable(): void;
}

export class BoardLogWatcher {
	private watcher: BoardWatchHandle | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private restartTimer: ReturnType<typeof setTimeout> | null = null;
	private liveFlag = false;
	private restartScheduled = false;
	private readonly callbacks: BoardLogWatcherCallbacks;
	private readonly watchFactory: BoardWatchFactory;

	constructor(callbacks: BoardLogWatcherCallbacks, watchFactory: BoardWatchFactory = watch) {
		this.callbacks = callbacks;
		this.watchFactory = watchFactory;
		this.start();
	}

	/** True while the watch stream is healthy and the last parse succeeded. */
	get live(): boolean {
		return this.liveFlag;
	}

	/** Retry watching (e.g. after the board appeared or the stream broke). */
	restart(): void {
		this.closeWatcher();
		this.start();
		// Catch up on changes the detached watch missed while re-attaching.
		if (this.watcher) {
			this.scheduleParse(this.callbacks.captureSelection());
		}
	}

	dispose(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		if (this.restartTimer) clearTimeout(this.restartTimer);
		this.closeWatcher();
	}

	private closeWatcher(): void {
		this.restartScheduled = false;
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
	}

	private start(): void {
		try {
			this.watcher = this.watchFactory(boardLogPath(), () => {
				const selectedId = this.callbacks.captureSelection();
				this.scheduleParse(selectedId);
			});
			this.watcher.unref?.();
			this.watcher.on?.("error", () => {
				this.markUnavailable();
			});
			this.liveFlag = true;
		} catch {
			this.markUnavailable();
		}
	}

	private scheduleRestart(): void {
		if (this.restartScheduled) return;
		this.restartScheduled = true;
		this.restartTimer = setTimeout(() => {
			this.restartTimer = null;
			this.restart();
		}, RESTART_DELAY_MS);
		this.restartTimer.unref?.();
	}

	private markUnavailable(): void {
		this.liveFlag = false;
		this.callbacks.onUnavailable();
		// A deleted or replaced board.log detaches the inode watch without an
		// error event; one bounded retry per outage re-attaches when it returns.
		this.scheduleRestart();
	}

	private scheduleParse(selectedId: string | undefined): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			this.parse(selectedId, false);
		}, DEBOUNCE_MS);
	}

	private parse(selectedId: string | undefined, isEmptyRecheck: boolean): void {
		parseBoard()
			.then((board) => {
				this.liveFlag = true;
				if (board.tasks.size === 0 && !isEmptyRecheck) {
					// A truncate-then-write rewrite exposes an empty log between
					// writes. Re-read once; only a persistently empty log is real.
					this.debounceTimer = setTimeout(() => {
						this.debounceTimer = null;
						this.parse(selectedId, true);
					}, EMPTY_RECHECK_MS);
					return;
				}
				this.callbacks.onBoard(board, selectedId);
			})
			.catch(() => {
				// The log vanished or is unreadable: keep the last complete
				// board, but report the view as not live until a parse succeeds.
				this.markUnavailable();
			});
	}
}