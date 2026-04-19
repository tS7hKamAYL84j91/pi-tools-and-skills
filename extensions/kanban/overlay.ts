/**
 * Kanban TUI Overlay — controller + state machine.
 *
 * Owns the FSWatcher subscription, the modal state machine
 * (board / detail / confirm-delete / move-picker), keyboard dispatch,
 * and routes mutations through the shared board.ts helpers so the log
 * format and column-rule validation stay in one place.
 *
 * All rendering lives in overlay-render.ts as pure functions — this
 * file is the controller, that file is the view.
 */

import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { matchesKey } from "@mariozechner/pi-tui";
import { type FSWatcher, watch } from "node:fs";
import {
	type BoardState,
	type TaskState,
	boardLogPath,
	deleteTask,
	moveTask,
	parseBoard,
} from "./board.js";
import {
	COLUMNS,
	type Column,
	DONE_LIMIT,
	renderBoard,
	renderConfirmDelete,
	renderDetail,
	renderMovePicker,
} from "./overlay-render.js";

const DEBOUNCE_MS = 150;

/** Hardcoded agent label written to board.log when the overlay mutates state. */
const OVERLAY_AGENT = "lead";

type Mode = "board" | "detail" | "confirm-delete" | "move-picker";

class KanbanOverlay implements Component {
	private board: BoardState;
	private activeColIdx = 2; // in-progress by default
	private activeRow = 0;
	private scroll: Record<Column, number> = {
		backlog: 0,
		todo: 0,
		"in-progress": 0,
		blocked: 0,
		done: 0,
	};
	private mode: Mode = "board";
	private statusMessage = "";
	private pendingDeleteTask: TaskState | null = null;
	private pendingMoveTask: TaskState | null = null;
	private watcher: FSWatcher | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private tui: TUI,
		private theme: Theme,
		initialBoard: BoardState,
		private done: (result: null) => void,
	) {
		this.board = initialBoard;
		this.startWatcher();
	}

	// ── Lifecycle ───────────────────────────────────────────────

	private startWatcher(): void {
		try {
			this.watcher = watch(boardLogPath(), () => {
				if (this.debounceTimer) clearTimeout(this.debounceTimer);
				this.debounceTimer = setTimeout(() => {
					parseBoard()
						.then((b) => {
							this.board = b;
							this.clampSelection();
							this.tui.requestRender();
						})
						.catch(() => { /* non-fatal */ });
				}, DEBOUNCE_MS);
			});
			this.watcher.unref();
		} catch {
			/* board.log may not exist yet — no live refresh */
		}
	}

	dispose(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
		this.pendingDeleteTask = null;
		this.pendingMoveTask = null;
	}

	// ── Data helpers ────────────────────────────────────────────

	private activeColumn(): Column {
		return COLUMNS[this.activeColIdx] ?? "in-progress";
	}

	private tasksIn(col: Column): TaskState[] {
		const out: TaskState[] = [];
		for (const tid of this.board.order) {
			const t = this.board.tasks.get(tid);
			if (!t || t.deleted || t.col !== col) continue;
			out.push(t);
		}
		if (col === "done") return out.slice(-DONE_LIMIT).reverse();
		return out;
	}

	private selectedTask(): TaskState | undefined {
		return this.tasksIn(this.activeColumn())[this.activeRow];
	}

	private clampSelection(): void {
		const tasks = this.tasksIn(this.activeColumn());
		if (this.activeRow >= tasks.length) {
			this.activeRow = Math.max(0, tasks.length - 1);
		}
	}

	private clampScroll(colTasks: TaskState[][], visibleRows: number): void {
		const col = this.activeColumn();
		const tasks = colTasks[this.activeColIdx] ?? [];
		if (tasks.length === 0) {
			this.scroll[col] = 0;
			return;
		}
		const offset = this.scroll[col];
		if (this.activeRow < offset) {
			this.scroll[col] = this.activeRow;
		} else if (this.activeRow >= offset + visibleRows) {
			this.scroll[col] = this.activeRow - visibleRows + 1;
		}
	}

	// ── Input handling ──────────────────────────────────────────

	handleInput(data: string): void {
		switch (this.mode) {
			case "detail":         this.handleDetailInput(data); return;
			case "confirm-delete": this.handleConfirmDeleteInput(data); return;
			case "move-picker":    this.handleMovePickerInput(data); return;
			default:               this.handleBoardInput(data); return;
		}
	}

	private handleDetailInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "left")) {
			this.mode = "board";
			this.statusMessage = "";
		}
	}

	private handleConfirmDeleteInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "n")) {
			this.mode = "board";
			this.pendingDeleteTask = null;
			this.statusMessage = "";
			return;
		}
		if (matchesKey(data, "y") || matchesKey(data, "enter") || matchesKey(data, "return")) {
			void this.executeDelete();
		}
	}

	private handleMovePickerInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.mode = "board";
			this.pendingMoveTask = null;
			this.statusMessage = "";
			return;
		}
		if (matchesKey(data, "1")) void this.executeMove("backlog");
		else if (matchesKey(data, "2")) void this.executeMove("todo");
	}

	private handleBoardInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.done(null);
			return;
		}

		if (matchesKey(data, "d")) {
			const task = this.selectedTask();
			if (task) {
				this.pendingDeleteTask = task;
				this.mode = "confirm-delete";
			}
			return;
		}

		if (matchesKey(data, "m")) {
			const task = this.selectedTask();
			if (task) {
				this.pendingMoveTask = task;
				this.mode = "move-picker";
			}
			return;
		}

		if (matchesKey(data, "left") || matchesKey(data, "shift+tab")) {
			this.activeColIdx = (this.activeColIdx + COLUMNS.length - 1) % COLUMNS.length;
			this.activeRow = 0;
			return;
		}

		if (matchesKey(data, "right") || matchesKey(data, "tab")) {
			this.activeColIdx = (this.activeColIdx + 1) % COLUMNS.length;
			this.activeRow = 0;
			return;
		}

		if (matchesKey(data, "up")) {
			if (this.activeRow > 0) this.activeRow--;
			return;
		}

		if (matchesKey(data, "down")) {
			const tasks = this.tasksIn(this.activeColumn());
			if (this.activeRow < tasks.length - 1) this.activeRow++;
			return;
		}

		if (matchesKey(data, "enter") || matchesKey(data, "return")) {
			if (this.selectedTask()) this.mode = "detail";
		}
	}

	// ── Mutations (delegated to board.ts helpers) ────────────────

	private async executeDelete(): Promise<void> {
		const task = this.pendingDeleteTask;
		this.pendingDeleteTask = null;
		this.mode = "board";
		if (!task) return;

		try {
			await deleteTask(task.id, OVERLAY_AGENT);
			this.statusMessage = "";
		} catch (err) {
			this.statusMessage = err instanceof Error ? err.message : String(err);
		}
		this.tui.requestRender();
	}

	private async executeMove(to: "backlog" | "todo"): Promise<void> {
		const task = this.pendingMoveTask;
		this.pendingMoveTask = null;
		this.mode = "board";
		if (!task) return;

		try {
			await moveTask(task.id, OVERLAY_AGENT, to);
			this.statusMessage = "";
		} catch (err) {
			this.statusMessage = err instanceof Error ? err.message : String(err);
		}
		this.tui.requestRender();
	}

	// ── Rendering (delegated to overlay-render.ts) ──────────────

	render(width: number): string[] {
		switch (this.mode) {
			case "detail":
				return renderDetail(this.selectedTask(), width, this.theme);
			case "confirm-delete":
				return renderConfirmDelete(this.pendingDeleteTask, width, this.theme);
			case "move-picker":
				return renderMovePicker(this.pendingMoveTask, width, this.theme);
			default: {
				const colTasks = COLUMNS.map((c) => this.tasksIn(c));
				// Same upper-bound used by renderBoard so the controller's scroll
				// math stays in sync with what the view will actually display.
				const maxRows = Math.max(8, ...colTasks.map((t) => t.length));
				this.clampScroll(colTasks, maxRows);
				return renderBoard(
					{
						colTasks,
						activeCol: this.activeColumn(),
						activeRow: this.activeRow,
						scroll: this.scroll,
						statusMessage: this.statusMessage,
					},
					width,
					this.theme,
				);
			}
		}
	}

	/** Component contract — no cached state, nothing to invalidate. */
	invalidate(): void {}
}

// ── Entry point ─────────────────────────────────────────────────

export async function openKanbanOverlay(ctx: ExtensionContext): Promise<void> {
	let board: BoardState;
	try {
		board = await parseBoard();
	} catch {
		ctx.ui.notify("Kanban board not available — set KANBAN_DIR or create a 'kanban' directory", "warning");
		return;
	}

	await ctx.ui.custom<null>(
		(tui, theme, _kb, done) => new KanbanOverlay(tui, theme, board, done),
		{
			overlay: true,
			overlayOptions: { anchor: "center", width: "95%", margin: 2 },
		},
	);
}
