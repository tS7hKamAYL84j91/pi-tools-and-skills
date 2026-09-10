/**
 * Kanban TUI Overlay — pure rendering functions.
 *
 * No state, no I/O, no class. Each exported function takes the data it
 * needs and returns the lines to push to the terminal. The KanbanOverlay
 * class in overlay.ts owns the controller state and calls into here.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { TaskState } from "./board.js";
import { WIP_LIMIT } from "./board.js";

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
	s
		.replace(RE_OSC, "")
		.replace(RE_DCS, "")
		.replace(RE_CSI, "")
		.replace(RE_C0, "");

// ── Layout constants ────────────────────────────────────────────

import {
	COLUMNS,
	type Column,
	type OverlayViewModel,
} from "./overlay-model.js";

export type { Column } from "./overlay-model.js";
export { COLUMNS } from "./overlay-model.js";

const COLUMN_LABELS: Record<Column, string> = {
	backlog: "BACKLOG",
	todo: "TODO",
	"in-progress": "IN PROG",
	blocked: "BLOCKED",
	done: "DONE",
};

const MIN_NARROW_COL_WIDTH = 10;
const MAX_COL_WIDTH = 40;
const FRAME_WIDTH = 6;

/** Board body rows rendered per column; longer columns scroll (selection stays visible). */
export const VIEWPORT_ROWS = 10;
/** Content-line window for the detail view; longer content scrolls with ↑/↓. */
const DETAIL_MAX_LINES = 16;

// ── Helpers ─────────────────────────────────────────────────────

/** Two-character priority badge; fixed width so rows align. */
function priorityBadge(priority: string, theme: Theme): string {
	switch (priority) {
		case "critical":
			return theme.fg("error", "!!");
		case "high":
			return theme.fg("warning", "! ");
		case "medium":
			return theme.fg("accent", "· ");
		case "low":
			return theme.fg("dim", "+ ");
		default:
			return theme.fg("dim", "  ");
	}
}

/** Pad a styled (ANSI-containing) string to the given visual width. */
function padVisible(styled: string, target: number): string {
	const w = visibleWidth(styled);
	if (w >= target) return styled;
	return styled + " ".repeat(target - w);
}

/** Hard-wrap a string at word boundaries to at most `width` visible cols. */
export function wrap(text: string, width: number): string[] {
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

export function frameTop(innerW: number, theme: Theme): string {
	return theme.fg("border", `  ╭${"─".repeat(innerW + 2)}╮`);
}

export function frameMiddle(innerW: number, theme: Theme): string {
	return theme.fg("border", `  ├${"─".repeat(innerW + 2)}┤`);
}

export function frameBottom(innerW: number, theme: Theme): string {
	return theme.fg("border", `  ╰${"─".repeat(innerW + 2)}╯`);
}

export function modalLine(content: string, innerW: number, theme: Theme): string {
	return (
		theme.fg("border", "  │ ") +
		padVisible(content, innerW) +
		theme.fg("border", " │")
	);
}

export function modalTruncatedLine(
	content: string,
	innerW: number,
	theme: Theme,
): string {
	return (
		theme.fg("border", "  │ ") +
		truncateToWidth(padVisible(content, innerW), innerW, "…", true) +
		theme.fg("border", " │")
	);
}

export function noSelectionLines(innerW: number, theme: Theme): string[] {
	return [
		modalLine(
			theme.fg("muted", " No task selected — press esc to return."),
			innerW,
			theme,
		),
		frameBottom(innerW, theme),
	];
}

export function modalInnerWidth(width: number): number {
	return Math.max(20, width - FRAME_WIDTH);
}

export function taskDisplayTitle(task: TaskState): string {
	return stripDangerousEscapes(task.title || task.id);
}

// ── View model ──────────────────────────────────────────────────

/** Snapshot of mutable controller state needed by the renderers. */
type BoardView = OverlayViewModel;

// ── Card rendering ──────────────────────────────────────────────

function renderCard(
	task: TaskState,
	colW: number,
	isSelected: boolean,
	theme: Theme,
): string {
	const badge = priorityBadge(task.priority, theme);
	const cursor = isSelected ? theme.fg("accent", ">") : " ";
	const id = isSelected
		? theme.bold(theme.fg("accent", task.id))
		: theme.fg("text", task.id);
	const titleRaw = taskDisplayTitle(task);
	const agentRaw = stripDangerousEscapes(task.claimAgent || "");

	// Reserve space for " cursor id badge " plus optional " (agent)".
	const fixed = visibleWidth(`${cursor} ${task.id} !! `);
	const agentWidth = agentRaw ? visibleWidth(` (${agentRaw})`) : 0;
	const titleBudget = Math.max(4, colW - fixed - agentWidth - 1);
	const title = truncateToWidth(titleRaw, titleBudget, "…", false);

	let line = ` ${cursor} ${id} ${badge}${title}`;
	if (agentRaw) line += theme.fg("muted", ` (${agentRaw})`);
	return padVisible(truncateToWidth(line, colW, "…", true), colW);
}

// ── Board view ──────────────────────────────────────────────────

export function renderBoard(
	view: BoardView,
	width: number,
	theme: Theme,
): string[] {
	const lines: string[] = [];

	// Compute column width that fits the viewport, degrading deliberately below
	// the preferred width instead of letting borders overrun 80-column terminals.
	const totalInnerBudget = Math.max(
		MIN_NARROW_COL_WIDTH * COLUMNS.length + COLUMNS.length - 1,
		width - FRAME_WIDTH,
	);
	const preferredColW = Math.floor(
		(totalInnerBudget - (COLUMNS.length - 1)) / COLUMNS.length,
	);
	const colW = Math.max(
		MIN_NARROW_COL_WIDTH,
		Math.min(MAX_COL_WIDTH, preferredColW),
	);
	const totalInner = colW * COLUMNS.length + (COLUMNS.length - 1);

	// Check for empty board
	const totalTasks = view.colTasks.reduce((sum, col) => sum + col.length, 0);

	// Top border + header: title on its own row so narrow terminals keep both.
	const title = theme.bold(theme.fg("accent", " Kanban Board"));
	const sortIndicator = theme.fg("dim", " [priority ↓]");
	const liveText = view.liveRefresh === false ? theme.fg("warning", " · not live") : theme.fg("dim", " · live");
	lines.push(frameTop(totalInner, theme));
	lines.push(modalTruncatedLine(`${title}${sortIndicator}${liveText}`, totalInner, theme));
	// Hint rows wrap instead of truncating so narrow terminals never hide actions.
	for (const hint of [
		" ← → column · ↑ ↓ row · / filter · enter detail · esc/q close",
		" c claim · x complete · n new · b block · u unblock · m move · d delete · t theme",
	]) {
		for (const chunk of wrap(hint, totalInner - 2)) {
			lines.push(
				modalTruncatedLine(theme.fg("dim", chunk), totalInner, theme),
			);
		}
	}	if (view.filterQuery || view.isFiltering) {
		const marker = view.isFiltering ? "Filter:" : "Filtered:";
		const query = view.filterQuery || "";
		const filterHint = query || "(type task id, title, or agent)";
		const filterLine = `${theme.fg("dim", ` ${marker}`)} ${theme.fg("text", filterHint)}`;
		lines.push(modalTruncatedLine(filterLine, totalInner, theme));
	}
	lines.push(frameMiddle(totalInner, theme));

	// Column headers
	const headerParts: string[] = [];
	for (let i = 0; i < COLUMNS.length; i++) {
		const col = COLUMNS[i] ?? "backlog";
		const count = (view.colTasks[i] ?? []).length;
		const hidden = col === "done" ? (view.hiddenDoneCount ?? 0) : 0;
		const wip =
			col === "in-progress"
				? `${count}/${WIP_LIMIT}`
				: `${count}${hidden > 0 ? `+${hidden}` : ""}`;
		const label = `${COLUMN_LABELS[col]} ${wip}`;
		const styled =
			col === view.activeCol
				? theme.bold(theme.fg("accent", label))
				: theme.fg("dim", label);
		headerParts.push(padVisible(` ${styled}`, colW));
	}
	lines.push(
		modalLine(headerParts.join(theme.fg("border", "│")), totalInner, theme),
	);
	lines.push(frameMiddle(totalInner, theme));

	// Empty board state
	if (totalTasks === 0) {
		const emptyText = view.filterQuery
			? ` No matching tasks for "${view.filterQuery}".`
			: " No tasks yet — press n to create one (or use kanban_create).";
		const emptyMsg = theme.fg("muted", emptyText);
		lines.push(modalTruncatedLine(emptyMsg, totalInner, theme));
	} else {
		// Body rows: a bounded window per column; longer columns scroll
		// (clampScroll keeps the selected row inside the window).
		const maxRows = Math.min(
			VIEWPORT_ROWS,
			Math.max(1, ...view.colTasks.map((t) => t.length)),
		);
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
				const isSelected =
					col === view.activeCol && row + offset === view.activeRow;
				rowParts.push(renderCard(task, colW, isSelected, theme));
			}
			lines.push(
				modalLine(rowParts.join(theme.fg("border", "│")), totalInner, theme),
			);
		}
	}

	lines.push(frameBottom(totalInner, theme));

	// Status message (transient)
	if (view.statusMessage) {
		const statusLine = theme.fg("warning", ` ${view.statusMessage}`);
		lines.push(modalTruncatedLine(statusLine, totalInner, theme));
	}

	return lines;
}

// ── Detail view ─────────────────────────────────────────────────

export function renderDetail(
	task: TaskState | undefined,
	width: number,
	theme: Theme,
	detailScroll = 0,
): string[] {
	const lines: string[] = [];
	const innerW = modalInnerWidth(width);

	lines.push(frameTop(innerW, theme));

	if (!task) {
		lines.push(...noSelectionLines(innerW, theme));
		return lines;
	}

	const headerInner = `${theme.bold(theme.fg("accent", task.id))} ${priorityBadge(task.priority, theme)} ${theme.bold(taskDisplayTitle(task))}`;
	lines.push(modalTruncatedLine(headerInner, innerW, theme));
	lines.push(frameMiddle(innerW, theme));

	const meta: [string, string][] = [
		["Column", task.col],
		["Priority", task.priority],
		["Agent", task.claimAgent || task.agent || "unassigned"],
		["Tags", task.tags || "(none)"],
		["Created", task.createdAt || "-"],
	];
	if (task.expires) meta.push(["Expires", task.expires]);
	if (task.completedAt) meta.push(["Completed", task.completedAt]);
	if (task.duration) meta.push(["Duration", task.duration]);
	if (task.reason) meta.push(["Block reason", task.reason]);

	for (const [key, value] of meta) {
		const row = ` ${theme.fg("dim", key.padEnd(13))} ${theme.fg("text", value)}`;
		lines.push(modalTruncatedLine(row, innerW, theme));
	}

	// Long content (description + notes) renders through a bounded window
	// that scrolls with ↑/↓; out-of-range offsets are clamped to content.
	const content: string[] = [];
	if (task.description) {
		content.push(modalLine("", innerW, theme));
		content.push(modalLine(` ${theme.fg("dim", "Description")}`, innerW, theme));
		for (const chunk of wrap(task.description, innerW - 2)) {
			content.push(modalLine(`  ${theme.fg("text", chunk)}`, innerW, theme));
		}
	}

	if (task.notes.length > 0) {
		content.push(modalLine("", innerW, theme));
		const noteHeader = ` ${theme.fg("dim", `Notes (${task.notes.length})`)}`;
		content.push(modalLine(noteHeader, innerW, theme));
		for (const note of task.notes.slice(-5)) {
			for (const chunk of wrap(`- ${note}`, innerW - 4)) {
				content.push(modalLine(`  ${theme.fg("text", chunk)}`, innerW, theme));
			}
		}
	}
	const maxScroll = Math.max(0, content.length - DETAIL_MAX_LINES);
	const scrollOffset = Math.min(Math.max(0, detailScroll), maxScroll);
	lines.push(...content.slice(scrollOffset, scrollOffset + DETAIL_MAX_LINES));
	if (content.length > DETAIL_MAX_LINES) {
		lines.push(
			modalLine(
				theme.fg("dim", ` ↑/↓ scroll (${scrollOffset}/${maxScroll})`),
				innerW,
				theme,
			),
		);
	}

	lines.push(frameMiddle(innerW, theme));
	lines.push(modalLine(theme.fg("dim", " esc/←/q back to board"), innerW, theme));
	lines.push(frameBottom(innerW, theme));
	return lines;
}
