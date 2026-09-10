/**
 * Kanban overlay modal dialogs: delete confirmation, move picker, and the
 * inline input prompts (new task / block reason). Pure rendering, no state.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { renderDestructiveConfirmationOverlay } from "../../lib/tui-confirmation.js";
import type { TaskState } from "./board.js";
import {
	frameBottom,
	frameMiddle,
	frameTop,
	modalInnerWidth,
	modalLine,
	modalTruncatedLine,
	noSelectionLines,
	taskDisplayTitle,
} from "./overlay-render.js";

// ── Confirm-delete dialog ──────────────────────────────────────

export function renderConfirmDelete(
	task: TaskState | null,
	width: number,
	theme: Theme,
): string[] {
	if (!task) {
		const innerW = modalInnerWidth(width);
		return [frameTop(innerW, theme), ...noSelectionLines(innerW, theme)];
	}

	return renderDestructiveConfirmationOverlay(
		{
			title: "Delete Task?",
			subject: `${task.id} ${taskDisplayTitle(task)}`,
			details: ["Appends a DELETE event; history remains in the board log."],
			severity: "warning",
		},
		width,
		theme,
	);
}

// ── Move-picker dialog ─────────────────────────────────────────

export function renderMovePicker(
	task: TaskState | null,
	width: number,
	theme: Theme,
	selectedIdx = 0,
): string[] {
	const lines: string[] = [];
	const innerW = modalInnerWidth(width);

	lines.push(frameTop(innerW, theme));

	if (!task) {
		lines.push(...noSelectionLines(innerW, theme));
		return lines;
	}

	const title = theme.bold(theme.fg("accent", " Move Task"));
	lines.push(modalLine(title, innerW, theme));
	lines.push(frameMiddle(innerW, theme));

	const taskInfo = ` ${task.id} ${taskDisplayTitle(task)} (currently: ${task.col})`;
	lines.push(modalTruncatedLine(theme.fg("text", taskInfo), innerW, theme));
	lines.push(modalLine("", innerW, theme));

	const targets: ("backlog" | "todo")[] = ["backlog", "todo"];
	for (const [index, target] of targets.entries()) {
		const current = task.col === target ? " (current)" : "";
		const text = `[${index + 1}] ${target}${current}`;
		const isSelected = index === selectedIdx;
		const cursor = isSelected ? theme.fg("accent", "> ") : "  ";
		const styled = isSelected ? theme.fg("accent", text) : theme.fg("text", text);
		lines.push(modalLine(`${cursor}${styled}`, innerW, theme));
	}

	const prompt = theme.fg(
		"warning",
		"  ↑/↓ or 1/2 to choose · enter to move · esc to go back",
	);
	lines.push(modalLine(prompt, innerW, theme));
	lines.push(frameBottom(innerW, theme));

	return lines;
}

// ── Inline input prompts ───────────────────────────────────────

interface InputPromptView {
	header: string;
	body: string;
	buffer: string;
	label: string;
	hint: string;
}

function renderInputPrompt(
	view: InputPromptView,
	width: number,
	theme: Theme,
): string[] {
	const innerW = modalInnerWidth(width);
	const lines: string[] = [];
	lines.push(frameTop(innerW, theme));
	lines.push(modalLine(theme.bold(theme.fg("accent", view.header)), innerW, theme));
	lines.push(frameMiddle(innerW, theme));
	lines.push(modalTruncatedLine(theme.fg("text", view.body), innerW, theme));
	lines.push(modalLine("", innerW, theme));
	lines.push(
		modalTruncatedLine(
			`${theme.fg("dim", ` ${view.label}`)} ${theme.fg("text", view.buffer || "")}`,
			innerW,
			theme,
		),
	);
	lines.push(modalLine(theme.fg("warning", `  ${view.hint}`), innerW, theme));
	lines.push(frameBottom(innerW, theme));
	return lines;
}

export function renderNewTaskPrompt(
	buffer: string,
	width: number,
	theme: Theme,
): string[] {
	return renderInputPrompt(
		{
			header: " New Task",
			body: "Created in backlog with medium priority; edit later with kanban_edit.",
			buffer,
			label: "title:",
			hint: "type title · enter create · esc to go back",
		},
		width,
		theme,
	);
}

export function renderBlockPrompt(
	task: TaskState | null,
	buffer: string,
	width: number,
	theme: Theme,
): string[] {
	if (!task) {
		const innerW = modalInnerWidth(width);
		return [frameTop(innerW, theme), ...noSelectionLines(innerW, theme)];
	}
	return renderInputPrompt(
		{
			header: " Block Task",
			body: ` ${task.id} ${taskDisplayTitle(task)}`,
			buffer,
			label: "reason:",
			hint: "type reason · enter block · esc to go back",
		},
		width,
		theme,
	);
}