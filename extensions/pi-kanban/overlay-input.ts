/**
 * Kanban overlay input layer: modal state machine and submode key handling.
 * Board navigation keys live in overlay-board-keys.ts; shared state types
 * live in overlay-input-state.ts.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import { handleBoardKey } from "./overlay-board-keys.js";
import { COLUMNS } from "./overlay-model.js";
import {
	applyPromptInput,
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
			handleNewTaskInput(state, deps, data);
			return;
		case "block-reason":
			handleBlockReasonInput(state, deps, data);
			return;
		default:
			handleBoardKey(state, deps, data);
			return;
	}
}

function flash(state: OverlayInputState, deps: OverlayInputDeps, message: string): void {
	state.statusMessage = message;
	deps.requestRender();
}

function handleDetailInput(state: OverlayInputState, data: string): void {
	if (
		matchesKey(data, "escape") ||
		matchesKey(data, "q") ||
		matchesKey(data, "left")
	) {
		state.mode = "board";
		state.statusMessage = "";
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
		void executePendingDelete(state, deps);
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
	if (matchesKey(data, "1")) void executePendingMove(state, deps, "backlog");
	else if (matchesKey(data, "2")) void executePendingMove(state, deps, "todo");
	else if (matchesKey(data, "up")) {
		state.movePickerIndex = 0;
		deps.requestRender();
	} else if (matchesKey(data, "down")) {
		state.movePickerIndex = 1;
		deps.requestRender();
	} else if (matchesKey(data, "enter") || matchesKey(data, "return")) {
		void executePendingMove(
			state,
			deps,
			state.movePickerIndex === 0 ? "backlog" : "todo",
		);
	}
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

function handleNewTaskInput(
	state: OverlayInputState,
	deps: OverlayInputDeps,
	data: string,
): void {
	const result = applyPromptInput(state.newTaskTitle, data);
	if (result.type === "submit") {
		const title = result.value.trim();
		state.mode = "board";
		state.newTaskTitle = "";
		if (title) void createFromOverlay(deps.ui, title);
	} else if (result.type === "cancel") {
		state.mode = "board";
		state.newTaskTitle = "";
		state.statusMessage = "";
	} else if (result.type === "edit") {
		state.newTaskTitle = result.buffer;
		deps.requestRender();
	}
}

function handleBlockReasonInput(
	state: OverlayInputState,
	deps: OverlayInputDeps,
	data: string,
): void {
	const result = applyPromptInput(state.blockReason, data);
	if (result.type === "submit") {
		const reason = result.value.trim();
		const task = state.pendingBlockTask;
		state.mode = "board";
		state.pendingBlockTask = null;
		state.blockReason = "";
		if (task && reason) void blockFromOverlay(deps.ui, task, reason);
		else if (task) flash(state, deps, "Block cancelled: reason required");
	} else if (result.type === "cancel") {
		state.mode = "board";
		state.pendingBlockTask = null;
		state.blockReason = "";
		state.statusMessage = "";
	} else if (result.type === "edit") {
		state.blockReason = result.buffer;
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

async function executePendingDelete(
	state: OverlayInputState,
	deps: OverlayInputDeps,
): Promise<void> {
	const task = state.pendingDeleteTask;
	state.pendingDeleteTask = null;
	state.mode = "board";
	if (task) await deleteFromOverlay(deps.ui, task);
}

async function executePendingMove(
	state: OverlayInputState,
	deps: OverlayInputDeps,
	to: "backlog" | "todo",
): Promise<void> {
	const task = state.pendingMoveTask;
	state.pendingMoveTask = null;
	state.mode = "board";
	if (task) await moveFromOverlay(deps.ui, task, to);
}