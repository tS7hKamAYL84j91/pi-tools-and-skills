/**
 * Kanban overlay board.log watcher: debounced live refresh with
 * selection capture at event time. Owns the FSWatcher, debounce timer,
 * and live flag so the controller stays free of watcher plumbing.
 */

import { type FSWatcher, watch } from "node:fs";
import { type BoardState, boardLogPath, parseBoard } from "./board.js";

const DEBOUNCE_MS = 150;

interface BoardLogWatcherCallbacks {
	/** Selection identity captured when the file event fires. */
	captureSelection(): string | undefined;
	/** A populated board parsed after the debounce. */
	onBoard(board: BoardState, selectedId: string | undefined): void;
	/** The watch stream failed; live refresh is over. */
	onWatchError(): void;
}

export class BoardLogWatcher {
	private watcher: FSWatcher | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private liveFlag = false;

	constructor(callbacks: BoardLogWatcherCallbacks) {
		try {
			this.watcher = watch(boardLogPath(), () => {
				const selectedId = callbacks.captureSelection();
				if (this.debounceTimer) clearTimeout(this.debounceTimer);
				this.debounceTimer = setTimeout(() => {
					parseBoard()
						.then((board) => {
							// A direct rewrite can briefly expose an empty log between
							// truncate and write; onBoard keeps the last complete board.
							if (board.tasks.size === 0) return;
							callbacks.onBoard(board, selectedId);
						})
						.catch(() => {
							/* non-fatal */
						});
				}, DEBOUNCE_MS);
			});
			this.watcher.unref();
			this.watcher.on("error", () => {
				this.liveFlag = false;
				callbacks.onWatchError();
			});
			this.liveFlag = true;
		} catch {
			this.liveFlag = false;
		}
	}

	get live(): boolean {
		return this.liveFlag;
	}

	dispose(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
	}
}