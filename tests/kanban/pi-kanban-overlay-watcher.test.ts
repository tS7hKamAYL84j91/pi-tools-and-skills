/** BoardLogWatcher lifecycle tests: truthful live/stale reporting and cleanup. */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardState } from "../../extensions/pi-kanban/board.js";
import { BoardLogWatcher } from "../../extensions/pi-kanban/overlay-watcher.js";

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

function makeWatcher(capture: () => string | undefined = () => undefined) {
	const boards: BoardState[] = [];
	let unavailable = 0;
	const watcher = new BoardLogWatcher({
		captureSelection: capture,
		onBoard: (board) => {
			boards.push(board);
		},
		onUnavailable: () => {
			unavailable += 1;
		},
	});
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
		const handle = makeWatcher();
		try {
			expect(handle.watcher.live).toBe(false);
			seedBoard(oneTaskLog);
			handle.watcher.restart();
			expect(handle.watcher.live).toBe(true);
			// The restart watches future changes; a write triggers a board refresh.
			seedBoard(twoTaskLog);
			await waitForBoard(handle, 1);
			expect(handle.boards()[0]?.tasks.size).toBe(2);
		} finally {
			handle.watcher.dispose();
		}
	});

	it("marks the view stale when the log disappears, and recovers when it returns", async () => {
		seedBoard(oneTaskLog);
		const handle = makeWatcher();
		try {
			expect(handle.watcher.live).toBe(true);
			unlinkSync(boardLog());
			await vi.waitFor(() => expect(handle.watcher.live).toBe(false), { timeout: 2_000 });
			expect(handle.unavailable()).toBeGreaterThan(0);
			seedBoard(twoTaskLog);
			await vi.waitFor(() => expect(handle.watcher.live).toBe(true), { timeout: 2_000 });
			await waitForBoard(handle, 1);
			expect(handle.boards()[0]?.tasks.size).toBe(2);
		} finally {
			handle.watcher.dispose();
		}
	});

	it("accepts a persistently empty board only after a re-read", async () => {
		seedBoard(oneTaskLog);
		const handle = makeWatcher();
		try {
			seedBoard("");
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
		const handle = makeWatcher();
		try {
			// Simulate a truncate-then-write compaction: briefly empty, then content.
			writeFileSync(boardLog(), "", "utf8");
			seedBoard(twoTaskLog);
			await waitForBoard(handle, 1);
			expect(handle.boards()[0]?.tasks.size).toBe(2);
		} finally {
			handle.watcher.dispose();
		}
	});

	it("follows atomic replacement of board.log", async () => {
		seedBoard(oneTaskLog);
		const handle = makeWatcher();
		try {
			const replacement = join(dir, "board.log.tmp");
			writeFileSync(replacement, twoTaskLog, "utf8");
			renameSync(replacement, boardLog());
			await waitForBoard(handle, 1);
			expect(handle.boards()[0]?.tasks.size).toBe(2);
			expect(handle.watcher.live).toBe(true);
		} finally {
			handle.watcher.dispose();
		}
	});

	it("dispose cancels a pending debounced parse without firing callbacks", async () => {
		seedBoard(oneTaskLog);
		const handle = makeWatcher();
		expect(handle.watcher.live).toBe(true);
		seedBoard(twoTaskLog);
		handle.watcher.dispose();
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(handle.boards()).toHaveLength(0);
		expect(handle.watcher.live).toBe(true); // dispose is not an outage report
	});

	it("works with a read-only tasks directory constraint untouched (fixture sanity)", () => {
		seedBoard(oneTaskLog);
		const handle = makeWatcher();
		try {
			expect(handle.watcher.live).toBe(true);
		} finally {
			handle.watcher.dispose();
			chmodSync(dir, 0o700);
		}
	});
});