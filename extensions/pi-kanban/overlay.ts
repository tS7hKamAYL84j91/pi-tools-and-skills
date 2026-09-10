/**
 * Kanban TUI Overlay — controller.
 *
 * Owns the board data, live refresh (overlay-watcher.ts), theme, and
 * rendering dispatch. Interaction state and key handling live in
 * overlay-input-state.ts / overlay-input.ts / overlay-board-keys.ts;
 * mutations run through overlay-actions and the shared board
 * transactions; rendering lives in overlay-render.ts and
 * overlay-dialogs.ts.
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import {
	type BoardState,
	parseBoard,
	type TaskState,
} from "./board.js";
import { type OverlayActions, overlayAgentId } from "./overlay-actions.js";
import {
	renderBlockPrompt,
	renderConfirmDelete,
	renderMovePicker,
	renderNewTaskPrompt,
} from "./overlay-dialogs.js";
import {
	handleOverlayInput,
	restoreOverlaySelection,
} from "./overlay-input.js";
import {
	activeColumn,
	createOverlayInputState,
	type OverlayInputDeps,
	type OverlayInputState,
} from "./overlay-input-state.js";
import {
	buildOverlayViewModel,
	DONE_LIMIT,
	tasksInColumn,
} from "./overlay-model.js";
import { type Column, renderBoard, renderDetail } from "./overlay-render.js";
import {
	applyKanbanTheme,
	type KanbanThemeName,
	kanbanThemeHelp,
	kanbanThemeName,
	nextKanbanTheme,
} from "./theme.js";
import { clampScrollOffset } from "./overlay-selection.js";
import { BoardLogWatcher } from "./overlay-watcher.js";

export class KanbanOverlay implements Component {
	private board: BoardState;
	private input: OverlayInputState;
	private scroll: Record<Column, number> = {
		backlog: 0,
		todo: 0,
		"in-progress": 0,
		blocked: 0,
		done: 0,
	};
	private readonly baseTheme: Theme;
	private themeName: KanbanThemeName;
	private theme: Theme;
	private readonly deps: OverlayInputDeps;
	private readonly actions: OverlayActions;
	private readonly boardWatcher: BoardLogWatcher;

	constructor(
		private tui: TUI,
		baseTheme: Theme,
		initialBoard: BoardState,
		private done: (result: null) => void,
		options: { agent?: string; cwd?: string } = {},
	) {
		this.board = initialBoard;
		this.input = createOverlayInputState();
		this.baseTheme = baseTheme;
		this.themeName = kanbanThemeName();
		this.theme = applyKanbanTheme(baseTheme, this.themeName);
		this.actions = {
			agent: options.agent ?? overlayAgentId(),
			cwd: options.cwd ?? process.cwd(),
			flash: (message) => this.flash(message),
		};
		this.deps = {
			ui: this.actions,
			tasksIn: (col) => this.tasksIn(col),
			selectedTask: () => this.selectedTask(),
			requestRender: () => this.tui.requestRender(),
			close: () => this.done(null),
			cycleTheme: () => this.cycleTheme(),
		};
		this.boardWatcher = new BoardLogWatcher({
			captureSelection: () =>
				this.input.mode === "search"
					? (this.input.filterSelectionId ?? this.selectedTask()?.id)
					: this.selectedTask()?.id,
			onBoard: (board, selectedId) => {
				this.board = board;
				restoreOverlaySelection(this.input, this.deps, selectedId);
				this.tui.requestRender();
			},
			onWatchError: () => this.tui.requestRender(),
		});
	}

	dispose(): void {
		this.boardWatcher.dispose();
	}

	// ── Data helpers ────────────────────────────────────────────

	private tasksIn(col: Column): TaskState[] {
		const out = tasksInColumn(this.board, col, this.input.filterQuery, false);
		if (col === "done") return out.slice(-DONE_LIMIT).reverse();
		return out;
	}

	private selectedTask(): TaskState | undefined {
		return this.tasksIn(activeColumn(this.input))[this.input.activeRow];
	}

	private clampScroll(colTasks: TaskState[][], visibleRows: number): void {
		const col = activeColumn(this.input);
		const tasks = colTasks[this.input.activeColIdx] ?? [];
		this.scroll[col] = clampScrollOffset(
			tasks.length,
			this.input.activeRow,
			visibleRows,
			this.scroll[col],
		);
	}

	flash(message: string): void {
		this.input.statusMessage = message;
		this.tui.requestRender();
	}

	private cycleTheme(): void {
		this.themeName = nextKanbanTheme(this.themeName);
		this.theme = applyKanbanTheme(this.baseTheme, this.themeName);
		this.flash(`Theme: ${this.themeName} (${kanbanThemeHelp()})`);
	}

	// ── Input ───────────────────────────────────────────────────

	handleInput(data: string): void {
		handleOverlayInput(this.input, this.deps, data);
	}

	// ── Rendering (delegated to overlay-render/dialogs) ─────────

	render(width: number): string[] {
		switch (this.input.mode) {
			case "detail":
				return renderDetail(this.selectedTask(), width, this.theme);
			case "confirm-delete":
				return renderConfirmDelete(
					this.input.pendingDeleteTask,
					width,
					this.theme,
				);
			case "move-picker":
				return renderMovePicker(
					this.input.pendingMoveTask,
					width,
					this.theme,
					this.input.movePickerIndex,
				);
			case "new-task":
				return renderNewTaskPrompt(this.input.newTaskTitle, width, this.theme);
			case "block-reason":
				return renderBlockPrompt(
					this.input.pendingBlockTask,
					this.input.blockReason,
					width,
					this.theme,
				);
			default: {
				const view = buildOverlayViewModel({
					board: this.board,
					activeCol: activeColumn(this.input),
					activeRow: this.input.activeRow,
					scroll: this.scroll,
					statusMessage: this.input.statusMessage,
					filterQuery: this.input.filterQuery,
					isFiltering: this.input.mode === "search",
					liveRefresh: this.boardWatcher.live,
				});
				// Keep controller scrolling in sync with the rows supplied to the view.
				const maxRows = Math.max(
					8,
					...view.colTasks.map((tasks) => tasks.length),
				);
				this.clampScroll(view.colTasks, maxRows);
				return renderBoard(view, width, this.theme);
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
		ctx.ui.notify(
			"Kanban board not available — set KANBAN_DIR or create a 'pi-kanban' directory",
			"warning",
		);
		return;
	}

	ctx.ui.notify(
		`Kanban board theme: ${kanbanThemeName()} (${kanbanThemeHelp()}) · actions recorded as "${overlayAgentId()}"`,
		"info",
	);
	await ctx.ui.custom<null>(
		(tui, theme, _kb, done) =>
			new KanbanOverlay(tui, theme, board, done, { cwd: ctx.cwd }),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "95%",
				minWidth: 60,
				maxHeight: "80%",
				margin: 2,
			},
		},
	);
}