/**
 * Kanban overlay interaction state: mode, selection, prompts, and pending
 * dialogs. Shared by the input handlers (overlay-input.ts, overlay-board-keys.ts)
 * and the controller (overlay.ts) without import cycles.
 */

import type { TaskState } from "./board.js";
import type { Column } from "./overlay-model.js";
import { COLUMNS } from "./overlay-model.js";
import type { OverlayActions } from "./overlay-actions.js";

export type Mode =
	| "board"
	| "detail"
	| "confirm-delete"
	| "move-picker"
	| "search"
	| "new-task"
	| "block-reason";

/** Mutable interaction state shared by input handlers and the controller. */
export interface OverlayInputState {
	mode: Mode;
	statusMessage: string;
	activeColIdx: number;
	activeRow: number;
	filterQuery: string;
	filterSelectionId: string | undefined;
	pendingDeleteTask: TaskState | null;
	pendingMoveTask: TaskState | null;
	movePickerIndex: number;
	newTaskTitle: string;
	pendingBlockTask: TaskState | null;
	blockReason: string;
}

export function createOverlayInputState(): OverlayInputState {
	return {
		mode: "board",
		statusMessage: "",
		activeColIdx: 2, // in-progress by default
		activeRow: 0,
		filterQuery: "",
		filterSelectionId: undefined,
		pendingDeleteTask: null,
		pendingMoveTask: null,
		movePickerIndex: 0,
		newTaskTitle: "",
		pendingBlockTask: null,
		blockReason: "",
	};
}

/** What the input layer needs from the controller. */
export interface OverlayInputDeps {
	ui: OverlayActions;
	tasksIn(col: Column): TaskState[];
	selectedTask(): TaskState | undefined;
	requestRender(): void;
	close(): void;
	cycleTheme(): void;
}

/** Active board column for the current selection index. */
export function activeColumn(state: OverlayInputState): Column {
	return COLUMNS[state.activeColIdx] ?? "in-progress";
}