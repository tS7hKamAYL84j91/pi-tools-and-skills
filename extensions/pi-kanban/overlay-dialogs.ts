/**
 * Kanban overlay modal dialogs: delete confirmation, move picker, and the
 * inline input prompts (new task / block reason). Prompts embed pi-tui's
 * Input component for native cursor editing and paste. Pure rendering, no state.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Input } from "@earendil-works/pi-tui";
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
	wrap,
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

function renderComponentLines(
	component: Component,
	innerW: number,
	theme: Theme,
): string[] {
	const rendered = component.render(innerW);
	return rendered.map((line) =>
		modalTruncatedLine(line, innerW, theme),
	);
}

function renderInputPrompt(
	view: {
		header: string;
		body: string;
		input: Input | null;
		hint: string;
	},
	width: number,
	theme: Theme,
): string[] {
	const innerW = modalInnerWidth(width);
	const lines: string[] = [];
	lines.push(frameTop(innerW, theme));
	lines.push(modalLine(theme.bold(theme.fg("accent", view.header)), innerW, theme));
	lines.push(frameMiddle(innerW, theme));
	for (const chunk of wrap(view.body, innerW - 2)) {
		lines.push(modalTruncatedLine(theme.fg("text", chunk), innerW, theme));
	}
	lines.push(modalLine("", innerW, theme));
	if (view.input) {
		lines.push(...renderComponentLines(view.input, innerW, theme));
	} else {
		lines.push(modalLine(theme.fg("muted", " (input unavailable)"), innerW, theme));
	}
	// Hints wrap instead of truncating so narrow terminals keep the wording.
	for (const chunk of wrap(view.hint, innerW - 2)) {
		lines.push(modalLine(theme.fg("warning", chunk), innerW, theme));
	}
	lines.push(frameBottom(innerW, theme));
	return lines;
}

export function renderNewTaskPrompt(
	input: Input | null,
	width: number,
	theme: Theme,
): string[] {
	return renderInputPrompt(
		{
			header: " New Task",
			body: "Created in backlog with medium priority; edit later with kanban_edit.",
			input,
			hint: "type title · enter create · esc to go back",
		},
		width,
		theme,
	);
}

export function renderBlockPrompt(
	task: TaskState | null,
	input: Input | null,
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
			input,
			hint: "type reason · enter block · esc to go back",
		},
		width,
		theme,
	);
}