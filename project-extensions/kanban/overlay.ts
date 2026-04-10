/**
 * Kanban TUI Overlay — /kanban slash command + ctrl+shift+k shortcut.
 *
 * Renders a 5-column board view (Backlog / Todo / In Progress / Blocked / Done)
 * with task counts, priority badges, claimed agents and a WIP indicator.
 *
 * Keyboard:
 *   ← →   switch column
 *   ↑ ↓   select row
 *   enter open detail view for the selected task
 *   esc/q close (from board) or back (from detail)
 *
 * Live-refresh: watches board.log via FSWatcher and calls tui.requestRender()
 * when changes arrive (debounced). Read-only — no task mutations from the
 * overlay; use the kanban_* tools for that.
 */

import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { type FSWatcher, watch } from "node:fs";
import {
	WIP_LIMIT,
	type BoardState,
	type TaskState,
	boardLogPath,
	parseBoard,
} from "./board.js";

// ── Layout constants ────────────────────────────────────────────

const COLUMNS = ["backlog", "todo", "in-progress", "blocked", "done"] as const;
type Column = (typeof COLUMNS)[number];

const COLUMN_LABELS: Record<Column, string> = {
	backlog: "BACKLOG",
	todo: "TODO",
	"in-progress": "IN PROG",
	blocked: "BLOCKED",
	done: "DONE",
};

const DEBOUNCE_MS = 150;
const DONE_LIMIT = 10;
const MIN_COL_WIDTH = 16;
const MAX_COL_WIDTH = 40;

// ── Helpers ─────────────────────────────────────────────────────

/** Two-character priority badge; fixed width so rows align. */
function priorityBadge(priority: string, theme: Theme): string {
	switch (priority) {
		case "critical": return theme.fg("error", "!!");
		case "high":     return theme.fg("warning", "! ");
		case "medium":   return theme.fg("accent", "· ");
		default:         return theme.fg("dim", "  ");
	}
}

/** Pad a styled (ANSI-containing) string to the given visual width. */
function padVisible(styled: string, target: number): string {
	const w = visibleWidth(styled);
	if (w >= target) return styled;
	return styled + " ".repeat(target - w);
}

/** Hard-wrap a string at word boundaries to at most `width` visible cols. */
function wrap(text: string, width: number): string[] {
	if (width <= 0) return [text];
	const words = text.split(/\s+/);
	const out: string[] = [];
	let line = "";
	for (const word of words) {
		if (!word) continue;
		if (line.length === 0) {
			line = word;
			continue;
		}
		if (line.length + 1 + word.length <= width) {
			line += ` ${word}`;
		} else {
			out.push(line);
			line = word;
		}
	}
	if (line) out.push(line);
	return out.length > 0 ? out : [""];
}

// ── Overlay component ───────────────────────────────────────────

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
	private mode: "board" | "detail" = "board";
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
		const tasks = this.tasksIn(this.activeColumn());
		return tasks[this.activeRow];
	}

	private clampSelection(): void {
		const tasks = this.tasksIn(this.activeColumn());
		if (this.activeRow >= tasks.length) {
			this.activeRow = Math.max(0, tasks.length - 1);
		}
	}

	// ── Input handling ──────────────────────────────────────────

	handleInput(data: string): void {
		if (this.mode === "detail") {
			if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "left")) {
				this.mode = "board";
			}
			return;
		}

		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.done(null);
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
			return;
		}
	}

	// ── Rendering ───────────────────────────────────────────────

	render(width: number): string[] {
		return this.mode === "detail" ? this.renderDetail(width) : this.renderBoard(width);
	}

	/** Component contract — no cached state, nothing to invalidate. */
	invalidate(): void {}

	// ── Board view ──────────────────────────────────────────────

	private renderBoard(width: number): string[] {
		const th = this.theme;
		const lines: string[] = [];

		// Compute column width that fits the available viewport.
		const usable = Math.max(MIN_COL_WIDTH * COLUMNS.length + COLUMNS.length - 1, width - 4);
		const colW = Math.max(
			MIN_COL_WIDTH,
			Math.min(MAX_COL_WIDTH, Math.floor((usable - (COLUMNS.length - 1)) / COLUMNS.length)),
		);
		const totalInner = colW * COLUMNS.length + (COLUMNS.length - 1);

		// Top border + header
		const title = th.bold(th.fg("accent", "📋 Kanban Board"));
		const hints = th.fg("dim", "← → column   ↑ ↓ row   enter detail   esc/q close");
		lines.push(th.fg("border", `  ╭${"─".repeat(totalInner + 2)}╮`));
		const headerRow = padVisible(`${title}   ${hints}`, totalInner);
		lines.push(th.fg("border", "  │ ") + truncateToWidth(headerRow, totalInner, "…", true) + th.fg("border", " │"));
		lines.push(th.fg("border", `  ├${"─".repeat(totalInner + 2)}┤`));

		// Column headers
		const colTasks = COLUMNS.map((c) => this.tasksIn(c));
		const activeCol = this.activeColumn();
		const headerParts: string[] = [];
		for (let i = 0; i < COLUMNS.length; i++) {
			const col = COLUMNS[i] ?? "backlog";
			const count = (colTasks[i] ?? []).length;
			const wip = col === "in-progress" ? `${count}/${WIP_LIMIT}` : `${count}`;
			const label = `${COLUMN_LABELS[col]} ${wip}`;
			const styled = col === activeCol ? th.bold(th.fg("accent", label)) : th.fg("dim", label);
			headerParts.push(padVisible(` ${styled}`, colW));
		}
		lines.push(th.fg("border", "  │ ") + headerParts.join(th.fg("border", "│")) + th.fg("border", " │"));
		lines.push(th.fg("border", `  ├${"─".repeat(totalInner + 2)}┤`));

		// Body
		const maxRows = Math.max(8, ...colTasks.map((t) => t.length));
		this.clampScroll(colTasks, maxRows);

		for (let row = 0; row < maxRows; row++) {
			const rowParts: string[] = [];
			for (let i = 0; i < COLUMNS.length; i++) {
				const col = COLUMNS[i] ?? "backlog";
				const tasks = colTasks[i] ?? [];
				const offset = this.scroll[col];
				const task = tasks[row + offset];
				if (!task) {
					rowParts.push(" ".repeat(colW));
					continue;
				}
				const isSelected = col === activeCol && row + offset === this.activeRow;
				rowParts.push(this.renderCard(task, colW, isSelected));
			}
			lines.push(th.fg("border", "  │ ") + rowParts.join(th.fg("border", "│")) + th.fg("border", " │"));
		}

		lines.push(th.fg("border", `  ╰${"─".repeat(totalInner + 2)}╯`));
		return lines;
	}

	private renderCard(task: TaskState, colW: number, isSelected: boolean): string {
		const th = this.theme;
		const badge = priorityBadge(task.priority, th);
		const cursor = isSelected ? th.fg("accent", "▶") : " ";
		const id = isSelected ? th.bold(th.fg("accent", task.id)) : th.fg("text", task.id);
		const titleRaw = task.title || task.id;
		const agentRaw = task.claimAgent || "";

		// Reserve space for " cursor id badge " plus optional " (agent)".
		const fixed = visibleWidth(`${cursor} ${task.id} !! `);
		const agentWidth = agentRaw ? visibleWidth(` (${agentRaw})`) : 0;
		const titleBudget = Math.max(4, colW - fixed - agentWidth - 1);
		const title = truncateToWidth(titleRaw, titleBudget, "…", false);

		let line = ` ${cursor} ${id} ${badge}${title}`;
		if (agentRaw) line += th.fg("muted", ` (${agentRaw})`);
		return padVisible(line, colW);
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

	// ── Detail view ─────────────────────────────────────────────

	private renderDetail(width: number): string[] {
		const th = this.theme;
		const task = this.selectedTask();
		const lines: string[] = [];
		const innerW = Math.max(40, width - 4);

		lines.push(th.fg("border", `  ╭${"─".repeat(innerW + 2)}╮`));

		if (!task) {
			const msg = th.fg("muted", " No task selected — press esc to return.");
			lines.push(th.fg("border", "  │ ") + padVisible(msg, innerW) + th.fg("border", " │"));
			lines.push(th.fg("border", `  ╰${"─".repeat(innerW + 2)}╯`));
			return lines;
		}

		const headerInner = `${th.bold(th.fg("accent", task.id))} ${priorityBadge(task.priority, th)} ${th.bold(task.title || task.id)}`;
		lines.push(th.fg("border", "  │ ") + truncateToWidth(padVisible(headerInner, innerW), innerW, "…", true) + th.fg("border", " │"));
		lines.push(th.fg("border", `  ├${"─".repeat(innerW + 2)}┤`));

		const meta: [string, string][] = [
			["Column",    task.col],
			["Priority",  task.priority],
			["Agent",     task.claimAgent || task.agent || "unassigned"],
			["Tags",      task.tags || "(none)"],
			["Created",   task.createdAt || "-"],
		];
		if (task.expires) meta.push(["Expires", task.expires]);
		if (task.completedAt) meta.push(["Completed", task.completedAt]);
		if (task.duration) meta.push(["Duration", task.duration]);
		if (task.reason) meta.push(["Block reason", task.reason]);

		for (const [key, value] of meta) {
			const row = ` ${th.fg("dim", key.padEnd(13))} ${th.fg("text", value)}`;
			lines.push(th.fg("border", "  │ ") + truncateToWidth(padVisible(row, innerW), innerW, "…", true) + th.fg("border", " │"));
		}

		if (task.description) {
			lines.push(th.fg("border", "  │ ") + padVisible("", innerW) + th.fg("border", " │"));
			lines.push(th.fg("border", "  │ ") + padVisible(` ${th.fg("dim", "Description")}`, innerW) + th.fg("border", " │"));
			for (const chunk of wrap(task.description, innerW - 2)) {
				lines.push(th.fg("border", "  │ ") + padVisible(`  ${th.fg("text", chunk)}`, innerW) + th.fg("border", " │"));
			}
		}

		if (task.notes.length > 0) {
			lines.push(th.fg("border", "  │ ") + padVisible("", innerW) + th.fg("border", " │"));
			const noteHeader = ` ${th.fg("dim", `Notes (${task.notes.length})`)}`;
			lines.push(th.fg("border", "  │ ") + padVisible(noteHeader, innerW) + th.fg("border", " │"));
			for (const note of task.notes.slice(-5)) {
				for (const chunk of wrap(`- ${note}`, innerW - 4)) {
					lines.push(th.fg("border", "  │ ") + padVisible(`  ${th.fg("text", chunk)}`, innerW) + th.fg("border", " │"));
				}
			}
		}

		lines.push(th.fg("border", `  ├${"─".repeat(innerW + 2)}┤`));
		lines.push(th.fg("border", "  │ ") + padVisible(th.fg("dim", " esc/← back to board"), innerW) + th.fg("border", " │"));
		lines.push(th.fg("border", `  ╰${"─".repeat(innerW + 2)}╯`));
		return lines;
	}
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
