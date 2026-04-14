/**
 * Kanban TUI Overlay — pure rendering functions.
 *
 * No state, no I/O, no class. Each exported function takes the data it
 * needs and returns the lines to push to the terminal. The KanbanOverlay
 * class in overlay.ts owns the controller state and calls into here.
 */

import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { WIP_LIMIT, type TaskState } from "./board.js";

// ── Sanitisation ────────────────────────────────────────────────

// Strip non-SGR escape sequences (OSC, DCS, CSI device queries, etc.)
// from untrusted strings. Uses RegExp constructor because regex literals
// with \x1b trigger Biome's noControlCharactersInRegex, but these control
// characters are exactly what we need to match.
// biome-ignore lint/complexity/useRegexLiterals: control chars are intentional — matching terminal escape sequences
const RE_OSC = new RegExp("\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)", "g");
// biome-ignore lint/complexity/useRegexLiterals: control chars are intentional
const RE_DCS = new RegExp("\\x1bP[^\\x1b]*\\x1b\\\\", "g");
// biome-ignore lint/complexity/useRegexLiterals: control chars are intentional
const RE_CSI = new RegExp("\\x1b\\[[^A-Za-z]*[^0-9;A-Za-z][A-Za-z]", "g");
// biome-ignore lint/complexity/useRegexLiterals: control chars are intentional
const RE_C0 = new RegExp("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1a]", "g");
const stripDangerousEscapes = (s: string): string =>
	s.replace(RE_OSC, "").replace(RE_DCS, "").replace(RE_CSI, "").replace(RE_C0, "");

// ── Layout constants ────────────────────────────────────────────

export const COLUMNS = ["backlog", "todo", "in-progress", "blocked", "done"] as const;
export type Column = (typeof COLUMNS)[number];

const COLUMN_LABELS: Record<Column, string> = {
	backlog: "BACKLOG",
	todo: "TODO",
	"in-progress": "IN PROG",
	blocked: "BLOCKED",
	done: "DONE",
};

export const DONE_LIMIT = 10;
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

// ── View model ──────────────────────────────────────────────────

/** Snapshot of mutable controller state needed by the renderers. */
interface BoardView {
	colTasks: TaskState[][];          // Tasks per column, in COLUMNS order
	activeCol: Column;
	activeRow: number;
	scroll: Record<Column, number>;
	statusMessage: string;
}

// ── Card rendering ──────────────────────────────────────────────

function renderCard(task: TaskState, colW: number, isSelected: boolean, theme: Theme): string {
	const badge = priorityBadge(task.priority, theme);
	const cursor = isSelected ? theme.fg("accent", "▶") : " ";
	const id = isSelected ? theme.bold(theme.fg("accent", task.id)) : theme.fg("text", task.id);
	const titleRaw = stripDangerousEscapes(task.title || task.id);
	const agentRaw = stripDangerousEscapes(task.claimAgent || "");

	// Reserve space for " cursor id badge " plus optional " (agent)".
	const fixed = visibleWidth(`${cursor} ${task.id} !! `);
	const agentWidth = agentRaw ? visibleWidth(` (${agentRaw})`) : 0;
	const titleBudget = Math.max(4, colW - fixed - agentWidth - 1);
	const title = truncateToWidth(titleRaw, titleBudget, "…", false);

	let line = ` ${cursor} ${id} ${badge}${title}`;
	if (agentRaw) line += theme.fg("muted", ` (${agentRaw})`);
	return padVisible(line, colW);
}

// ── Board view ──────────────────────────────────────────────────

export function renderBoard(view: BoardView, width: number, theme: Theme): string[] {
	const lines: string[] = [];

	// Compute column width that fits the available viewport.
	const usable = Math.max(MIN_COL_WIDTH * COLUMNS.length + COLUMNS.length - 1, width - 4);
	const colW = Math.max(
		MIN_COL_WIDTH,
		Math.min(MAX_COL_WIDTH, Math.floor((usable - (COLUMNS.length - 1)) / COLUMNS.length)),
	);
	const totalInner = colW * COLUMNS.length + (COLUMNS.length - 1);

	// Top border + header
	const title = theme.bold(theme.fg("accent", "📋 Kanban Board"));
	const hints = theme.fg("dim", "← → column   ↑ ↓ row   enter detail   d delete   m move   esc/q close");
	lines.push(theme.fg("border", `  ╭${"─".repeat(totalInner + 2)}╮`));
	const headerRow = padVisible(`${title}   ${hints}`, totalInner);
	lines.push(theme.fg("border", "  │ ") + truncateToWidth(headerRow, totalInner, "…", true) + theme.fg("border", " │"));
	lines.push(theme.fg("border", `  ├${"─".repeat(totalInner + 2)}┤`));

	// Column headers
	const headerParts: string[] = [];
	for (let i = 0; i < COLUMNS.length; i++) {
		const col = COLUMNS[i] ?? "backlog";
		const count = (view.colTasks[i] ?? []).length;
		const wip = col === "in-progress" ? `${count}/${WIP_LIMIT}` : `${count}`;
		const label = `${COLUMN_LABELS[col]} ${wip}`;
		const styled = col === view.activeCol ? theme.bold(theme.fg("accent", label)) : theme.fg("dim", label);
		headerParts.push(padVisible(` ${styled}`, colW));
	}
	lines.push(theme.fg("border", "  │ ") + headerParts.join(theme.fg("border", "│")) + theme.fg("border", " │"));
	lines.push(theme.fg("border", `  ├${"─".repeat(totalInner + 2)}┤`));

	// Body rows
	const maxRows = Math.max(8, ...view.colTasks.map((t) => t.length));
	for (let row = 0; row < maxRows; row++) {
		const rowParts: string[] = [];
		for (let i = 0; i < COLUMNS.length; i++) {
			const col = COLUMNS[i] ?? "backlog";
			const tasks = view.colTasks[i] ?? [];
			const offset = view.scroll[col];
			const task = tasks[row + offset];
			if (!task) {
				rowParts.push(" ".repeat(colW));
				continue;
			}
			const isSelected = col === view.activeCol && row + offset === view.activeRow;
			rowParts.push(renderCard(task, colW, isSelected, theme));
		}
		lines.push(theme.fg("border", "  │ ") + rowParts.join(theme.fg("border", "│")) + theme.fg("border", " │"));
	}

	lines.push(theme.fg("border", `  ╰${"─".repeat(totalInner + 2)}╯`));

	// Status message (transient)
	if (view.statusMessage) {
		const statusLine = theme.fg("warning", ` ${view.statusMessage}`);
		lines.push(theme.fg("border", "  │ ") + truncateToWidth(padVisible(statusLine, totalInner), totalInner, "…", true) + theme.fg("border", " │"));
	}

	return lines;
}

// ── Detail view ─────────────────────────────────────────────────

export function renderDetail(task: TaskState | undefined, width: number, theme: Theme): string[] {
	const lines: string[] = [];
	const innerW = Math.max(40, width - 4);

	lines.push(theme.fg("border", `  ╭${"─".repeat(innerW + 2)}╮`));

	if (!task) {
		const msg = theme.fg("muted", " No task selected — press esc to return.");
		lines.push(theme.fg("border", "  │ ") + padVisible(msg, innerW) + theme.fg("border", " │"));
		lines.push(theme.fg("border", `  ╰${"─".repeat(innerW + 2)}╯`));
		return lines;
	}

	const headerInner = `${theme.bold(theme.fg("accent", task.id))} ${priorityBadge(task.priority, theme)} ${theme.bold(stripDangerousEscapes(task.title || task.id))}`;
	lines.push(theme.fg("border", "  │ ") + truncateToWidth(padVisible(headerInner, innerW), innerW, "…", true) + theme.fg("border", " │"));
	lines.push(theme.fg("border", `  ├${"─".repeat(innerW + 2)}┤`));

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
		const row = ` ${theme.fg("dim", key.padEnd(13))} ${theme.fg("text", value)}`;
		lines.push(theme.fg("border", "  │ ") + truncateToWidth(padVisible(row, innerW), innerW, "…", true) + theme.fg("border", " │"));
	}

	if (task.description) {
		lines.push(theme.fg("border", "  │ ") + padVisible("", innerW) + theme.fg("border", " │"));
		lines.push(theme.fg("border", "  │ ") + padVisible(` ${theme.fg("dim", "Description")}`, innerW) + theme.fg("border", " │"));
		for (const chunk of wrap(task.description, innerW - 2)) {
			lines.push(theme.fg("border", "  │ ") + padVisible(`  ${theme.fg("text", chunk)}`, innerW) + theme.fg("border", " │"));
		}
	}

	if (task.notes.length > 0) {
		lines.push(theme.fg("border", "  │ ") + padVisible("", innerW) + theme.fg("border", " │"));
		const noteHeader = ` ${theme.fg("dim", `Notes (${task.notes.length})`)}`;
		lines.push(theme.fg("border", "  │ ") + padVisible(noteHeader, innerW) + theme.fg("border", " │"));
		for (const note of task.notes.slice(-5)) {
			for (const chunk of wrap(`- ${note}`, innerW - 4)) {
				lines.push(theme.fg("border", "  │ ") + padVisible(`  ${theme.fg("text", chunk)}`, innerW) + theme.fg("border", " │"));
			}
		}
	}

	lines.push(theme.fg("border", `  ├${"─".repeat(innerW + 2)}┤`));
	lines.push(theme.fg("border", "  │ ") + padVisible(theme.fg("dim", " esc/← back to board"), innerW) + theme.fg("border", " │"));
	lines.push(theme.fg("border", `  ╰${"─".repeat(innerW + 2)}╯`));
	return lines;
}

// ── Confirm-delete view ─────────────────────────────────────────

export function renderConfirmDelete(task: TaskState | null, width: number, theme: Theme): string[] {
	const lines: string[] = [];
	const innerW = Math.max(40, width - 4);

	lines.push(theme.fg("border", `  ╭${"─".repeat(innerW + 2)}╮`));

	if (!task) {
		const msg = theme.fg("muted", " No task selected — press esc to return.");
		lines.push(theme.fg("border", "  │ ") + padVisible(msg, innerW) + theme.fg("border", " │"));
		lines.push(theme.fg("border", `  ╰${"─".repeat(innerW + 2)}╯`));
		return lines;
	}

	const title = theme.bold(theme.fg("error", " ⚠ Delete Task?"));
	lines.push(theme.fg("border", "  │ ") + padVisible(title, innerW) + theme.fg("border", " │"));
	lines.push(theme.fg("border", `  ├${"─".repeat(innerW + 2)}┤`));

	const taskInfo = ` ${task.id} ${stripDangerousEscapes(task.title || task.id)}`;
	lines.push(theme.fg("border", "  │ ") + truncateToWidth(padVisible(theme.fg("text", taskInfo), innerW), innerW, "…", true) + theme.fg("border", " │"));
	lines.push(theme.fg("border", "  │ ") + padVisible("", innerW) + theme.fg("border", " │"));

	const prompt = theme.fg("warning", "  Press 'y' to delete, 'n' or esc to cancel");
	lines.push(theme.fg("border", "  │ ") + padVisible(prompt, innerW) + theme.fg("border", " │"));
	lines.push(theme.fg("border", `  ╰${"─".repeat(innerW + 2)}╯`));

	return lines;
}

// ── Move-picker view ────────────────────────────────────────────

export function renderMovePicker(task: TaskState | null, width: number, theme: Theme): string[] {
	const lines: string[] = [];
	const innerW = Math.max(40, width - 4);

	lines.push(theme.fg("border", `  ╭${"─".repeat(innerW + 2)}╮`));

	if (!task) {
		const msg = theme.fg("muted", " No task selected — press esc to return.");
		lines.push(theme.fg("border", "  │ ") + padVisible(msg, innerW) + theme.fg("border", " │"));
		lines.push(theme.fg("border", `  ╰${"─".repeat(innerW + 2)}╯`));
		return lines;
	}

	const title = theme.bold(theme.fg("accent", " ↷ Move Task"));
	lines.push(theme.fg("border", "  │ ") + padVisible(title, innerW) + theme.fg("border", " │"));
	lines.push(theme.fg("border", `  ├${"─".repeat(innerW + 2)}┤`));

	const taskInfo = ` ${task.id} ${stripDangerousEscapes(task.title || task.id)} (currently: ${task.col})`;
	lines.push(theme.fg("border", "  │ ") + truncateToWidth(padVisible(theme.fg("text", taskInfo), innerW), innerW, "…", true) + theme.fg("border", " │"));
	lines.push(theme.fg("border", "  │ ") + padVisible("", innerW) + theme.fg("border", " │"));

	const backlogOption = task.col === "backlog" ? theme.fg("dim", "[1] backlog (current)") : theme.fg("text", "[1] backlog");
	const todoOption = task.col === "todo" ? theme.fg("dim", "[2] todo (current)") : theme.fg("text", "[2] todo");
	const options = `  ${backlogOption}   ${todoOption}`;
	lines.push(theme.fg("border", "  │ ") + padVisible(options, innerW) + theme.fg("border", " │"));

	const prompt = theme.fg("warning", "  Press 1 or 2 to move, esc to cancel");
	lines.push(theme.fg("border", "  │ ") + padVisible(prompt, innerW) + theme.fg("border", " │"));
	lines.push(theme.fg("border", `  ╰${"─".repeat(innerW + 2)}╯`));

	return lines;
}
