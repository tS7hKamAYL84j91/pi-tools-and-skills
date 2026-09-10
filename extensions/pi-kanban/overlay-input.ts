/**
 * Kanban overlay input layer: modal state machine and submode key handling.
 * Board navigation keys live in overlay-board-keys.ts; shared state types
 * live in overlay-input-state.ts. Inline prompts embed pi-tui's Input for
 * native cursor editing, word ops, undo, and bracketed paste.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import { handleBoardKey } from "./overlay-board-keys.js";
import { COLUMNS } from "./overlay-model.js";
import {
	blockFromOverlay,
	createFromOverlay,
	deleteFromOverlay,
	moveFromOverlay,
} from "./overlay-actions.js";
import {
	activeColumn,
	type OverlayInputDeps,
	type OverlayInputState,
} from "./overlay-input-state.js";
import { restoreSelectedRow } from "./overlay-selection.js";

export function handleOverlayInput(
	state: OverlayInputState,
	deps: OverlayInputDeps,
	data: string,
): void {
	switch (state.mode) {
		case "detail":
			handleDetailInput(state, data);
			return;
		case "confirm-delete":
			handleConfirmDeleteInput(state, deps, data);
			return;
		case "move-picker":
			handleMovePickerInput(state, deps, data);
			return;
		case "search":
			handleSearchInput(state, deps, data);
			return;
		case "new-task":
			handlePromptInput(state, deps, data, submitNewTask);
			return;
		case "block-reason":
			handlePromptInput(state, deps, data, submitBlockReason);
			return;
		default:
			handleBoardKey(state, deps, data);
			return;
	}
}

function handleDetailInput(state: OverlayInputState, data: string): void {
	if (
		matchesKey(data, "escape") ||
		matchesKey(data, "q") ||
		matchesKey(data, "left")
	) {
		state.mode = "board";
		state.statusMessage = "";
		state.detailScroll = 0;
		return;
	}
	if (matchesKey(data, "up")) {
		state.detailScroll = Math.max(0, state.detailScroll - 1);
		return;
	}
	if (matchesKey(data, "down")) {
		state.detailScroll = Math.min(
			Number.MAX_SAFE_INTEGER,
			state.detailScroll + 1,
		);
	}
}

function handleConfirmDeleteInput(
	state: OverlayInputState,
	deps: OverlayInputDeps,
	data: string,
): void {
	// Deliberately no Enter/Return: the destructive default must not share
	// the key that opens detail views. Only y proceeds; n/esc/q dismisses.
	if (
		matchesKey(data, "escape") ||
		matchesKey(data, "q") ||
		matchesKey(data, "n")
	) {
		state.mode = "board";
		state.pendingDeleteTask = null;
		state.statusMessage = "";
		return;
	}
	if (matchesKey(data, "y")) {
		const task = state.pendingDeleteTask;
		state.pendingDeleteTask = null;
		state.mode = "board";
		if (task) {
			deps.runOperation("delete", () => deleteFromOverlay(deps.ui, task));
		}
	}
}

function handleMovePickerInput(
	state: OverlayInputState,
	deps: OverlayInputDeps,
	data: string,
): void {
	if (matchesKey(data, "escape") || matchesKey(data, "q")) {
		state.mode = "board";
		state.pendingMoveTask = null;
		state.statusMessage = "";
		return;
	}
	if (matchesKey(data, "1")) void executeMove(state, deps, "backlog");
	else if (matchesKey(data, "2")) void executeMove(state, deps, "todo");
	else if (matchesKey(data, "up")) {
		state.movePickerIndex = 0;
		deps.requestRender();
	} else if (matchesKey(data, "down")) {
		state.movePickerIndex = 1;
		deps.requestRender();
	} else if (matchesKey(data, "enter") || matchesKey(data, "return")) {
		void executeMove(
			state,
			deps,
			state.movePickerIndex === 0 ? "backlog" : "todo",
		);
	}
}

function executeMove(
	state: OverlayInputState,
	deps: OverlayInputDeps,
	to: "backlog" | "todo",
): Promise<void> {
	const task = state.pendingMoveTask;
	state.pendingMoveTask = null;
	state.mode = "board";
	return Promise.resolve(
		task ? deps.runOperation("move", () => moveFromOverlay(deps.ui, task, to)) : undefined,
	);
}

function handleSearchInput(
	state: OverlayInputState,
	deps: OverlayInputDeps,
	data: string,
): void {
	if (matchesKey(data, "escape")) {
		state.filterQuery = "";
		state.mode = "board";
		state.statusMessage = "";
		restoreFilterSelection(state, deps);
		state.filterSelectionId = undefined;
		return;
	}
	if (matchesKey(data, "enter") || matchesKey(data, "return")) {
		state.mode = "board";
		state.statusMessage = "";
		restoreFilterSelection(state, deps);
		state.filterSelectionId = undefined;
		return;
	}
	if (matchesKey(data, "backspace") || matchesKey(data, "delete")) {
		state.filterQuery = state.filterQuery.slice(0, -1);
		restoreFilterSelection(state, deps);
		return;
	}
	if (data.length === 1 && data >= " ") {
		state.filterQuery += data;
		restoreFilterSelection(state, deps);
	}
}

function handlePromptInput(
	state: OverlayInputState,
	deps: OverlayInputDeps,
	data: string,
	submit: (state: OverlayInputState, deps: OverlayInputDeps, value: string) => void,
): void {
	const input = state.promptInput;
	if (!input) {
		state.mode = "board";
		return;
	}
	if (matchesKey(data, "escape")) {
		state.mode = "board";
		state.promptInput = null;
		state.statusMessage = "";
		return;
	}
	if (matchesKey(data, "enter") || matchesKey(data, "return")) {
		const value = input.getValue();
		state.mode = "board";
		state.promptInput = null;
		submit(state, deps, value);
		return;
	}
	// All other keys — including multi-character paste chunks — go to the
	// native Input for cursor editing, word operations, undo, and paste.
	input.handleInput(data);
	deps.requestRender();
}

function submitNewTask(
	state: OverlayInputState,
	deps: OverlayInputDeps,
	value: string,
): void {
	const title = value.trim();
	if (title) {
		deps.runOperation("create", () => createFromOverlay(deps.ui, title));
	} else {
		state.statusMessage = "";
	}
}

function submitBlockReason(
	state: OverlayInputState,
	deps: OverlayInputDeps,
	value: string,
): void {
	const reason = value.trim();
	const task = state.pendingBlockTask;
	state.pendingBlockTask = null;
	if (task && reason) {
		deps.runOperation("block", () =>
			blockFromOverlay(deps.ui, task, reason),
		);
	} else if (task) {
		state.statusMessage = "Block cancelled: reason required";
		deps.requestRender();
	}
}

/** Restore the row selection after a board refresh (by captured task id). */
export function restoreOverlaySelection(
	state: OverlayInputState,
	deps: OverlayInputDeps,
	selectedId: string | undefined,
): void {
	const tasks = deps.tasksIn(activeColumn(state));
	if (tasks.length === 0) {
		const nextColumnIndex = COLUMNS.findIndex(
			(column) => deps.tasksIn(column).length > 0,
		);
		if (nextColumnIndex >= 0) state.activeColIdx = nextColumnIndex;
		state.activeRow = 0;
		return;
	}
	state.activeRow = restoreSelectedRow(tasks, selectedId, state.activeRow);
}

function restoreFilterSelection(
	state: OverlayInputState,
	deps: OverlayInputDeps,
): void {
	state.activeRow = restoreSelectedRow(
		deps.tasksIn(activeColumn(state)),
		state.filterSelectionId,
		state.activeRow,
	);
}