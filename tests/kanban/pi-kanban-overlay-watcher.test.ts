/**
 * BoardLogWatcher lifecycle tests: truthful live/stale reporting and cleanup.
 * Watch handles are injected fakes — no real inotify instances — so the suite
 * stays hermetic on machines with loaded watcher limits. Events are fired
 * through the captured factory callbacks.
 */
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardState } from "../../extensions/pi-kanban/board.js";
import { type BoardWatchFactory, BoardLogWatcher } from "../../extensions/pi-kanban/overlay-watcher.js";

let dir = "";
const boardLog = () => join(dir, "board.log");

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "kanban-watcher-test-"));
	mkdirSync(join(dir, "tasks"), { recursive: true });
	process.env.KANBAN_DIR = dir;
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function seedBoard(content: string): void {
	writeFileSync(boardLog(), content, "utf8");
}

const oneTaskLog = '2026-01-01T00:00:00Z CREATE T-001 lead title="Only" priority="high" tags=""\n';
const twoTaskLog = `${oneTaskLog}2026-01-01T00:00:01Z CREATE T-002 lead title="Second" priority="low" tags=""\n`;

/** Fake watch factory: records the active callback and lets tests fire events. */
function makeWatchHarness() {
	let activeCallback: ((event: string, filename: string | Buffer | null) => void) | null = null;
	let watchAttempts = 0;
	let failNextStart = false;
	const closed: number[] = [];
	const factory: BoardWatchFactory = (_path, callback) => {
		watchAttempts += 1;
		if (failNextStart) {
			failNextStart = false;
			throw new Error("watch start failed");
		}
		activeCallback = callback;
		return {
			close: () => {
				closed.push(watchAttempts);
				activeCallback = null;
			},
		};
	};
	return {
		factory,
		fire: (event = "change") => activeCallback?.(event, null),
		active: () => activeCallback !== null,
		watchAttempts: () => watchAttempts,
		closedCount: () => closed.length,
		failNextStartOnce: () => {
			failNextStart = true;
		},
	};
}

function makeWatcher(harness: ReturnType<typeof makeWatchHarness>) {
	const boards: BoardState[] = [];
	let unavailable = 0;
	const watcher = new BoardLogWatcher(
		{
			captureSelection: () => undefined,
			onBoard: (board) => {
				boards.push(board);
			},
			onUnavailable: () => {
				unavailable += 1;
			},
		},
		harness.factory,
	);
	return {
		watcher,
		boards: () => boards,
		unavailable: () => unavailable,
	};
}

async function waitForBoard(handle: ReturnType<typeof makeWatcher>, count: number): Promise<void> {
	await vi.waitFor(() => expect(handle.boards()).toHaveLength(count), { timeout: 2_000 });
}

describe("BoardLogWatcher live reporting", () => {
	it("reports not live when the board cannot be watched, then recovers on restart", async () => {
		expect(existsSync(boardLog())).toBe(false);
		const harness = makeWatchHarness();
		harness.failNextStartOnce();
		const handle = makeWatcher(harness);
		try {
			expect(handle.watcher.live).toBe(false);
			expect(handle.unavailable()).toBe(1);
			seedBoard(oneTaskLog);
			handle.watcher.restart();
			expect(handle.watcher.live).toBe(true);
			expect(harness.active()).toBe(true);
			seedBoard(twoTaskLog);
			harness.fire();
			await waitForBoard(handle, 1);
			expect(handle.boards()[0]?.tasks.size).toBe(2);
		} finally {
			handle.watcher.dispose();
		}
	});

	it("marks the view stale when the log disappears, and recovers when it returns", async () => {
		seedBoard(oneTaskLog);
		const harness = makeWatchHarness();
		const handle = makeWatcher(harness);
		try {
			expect(handle.watcher.live).toBe(true);
			unlinkSync(boardLog());
			harness.fire("rename"); // a deleted watch target fires a rename event
			await vi.waitFor(() => expect(handle.watcher.live).toBe(false), { timeout: 2_000 });
			expect(handle.unavailable()).toBeGreaterThan(0);
			// Recovery: the bounded restart re-attaches after the log returns,
			// and its catch-up parse reports the missed content.
			seedBoard(twoTaskLog);
			await vi.waitFor(() => expect(handle.watcher.live).toBe(true), { timeout: 4_000 });
			await waitForBoard(handle, 1);
			expect(handle.boards()[0]?.tasks.size).toBe(2);
		} finally {
			handle.watcher.dispose();
		}
	});

	it("accepts a persistently empty board only after a re-read", async () => {
		seedBoard(oneTaskLog);
		const harness = makeWatchHarness();
		const handle = makeWatcher(harness);
		try {
			seedBoard("");
			harness.fire();
			await waitForBoard(handle, 1);
			// A truncate-then-write rewrite (compaction) is never mistaken for
			// an empty board before the re-read confirms it.
			expect(handle.boards()[0]?.tasks.size).toBe(0);
			expect(handle.watcher.live).toBe(true);
		} finally {
			handle.watcher.dispose();
		}
	});

	it("does not accept a mid-rewrite empty parse before content lands", async () => {
		seedBoard(oneTaskLog);
		const harness = makeWatchHarness();
		const handle = makeWatcher(harness);
		try {
			// Simulate a truncate-then-write compaction: briefly empty, then content.
			writeFileSync(boardLog(), "", "utf8");
			harness.fire();
			seedBoard(twoTaskLog); // content lands inside the empty-recheck window
			await waitForBoard(handle, 1);
			expect(handle.boards()[0]?.tasks.size).toBe(2);
		} finally {
			handle.watcher.dispose();
		}
	});

	it("follows atomic replacement of board.log", async () => {
		seedBoard(oneTaskLog);
		const harness = makeWatchHarness();
		const handle = makeWatcher(harness);
		try {
			const replacement = join(dir, "board.log.tmp");
			writeFileSync(replacement, twoTaskLog, "utf8");
			renameSync(replacement, boardLog());
			harness.fire("rename");
			await waitForBoard(handle, 1);
			expect(handle.boards()[0]?.tasks.size).toBe(2);
			expect(handle.watcher.live).toBe(true);
		} finally {
			handle.watcher.dispose();
		}
	});

	it("dispose cancels a pending debounced parse without firing callbacks", async () => {
		seedBoard(oneTaskLog);
		const harness = makeWatchHarness();
		const handle = makeWatcher(harness);
		expect(handle.watcher.live).toBe(true);
		seedBoard(twoTaskLog);
		harness.fire();
		handle.watcher.dispose();
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(handle.boards()).toHaveLength(0);
		expect(harness.closedCount()).toBe(1); // the watch handle is closed
	});
});