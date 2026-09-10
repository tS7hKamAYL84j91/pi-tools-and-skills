/**
 * Kanban overlay interaction state: mode, selection, prompts, and pending
 * dialogs. Shared by the input handlers (overlay-input.ts, overlay-board-keys.ts)
 * and the controller (overlay.ts) without import cycles.
 */

import { Input } from "@earendil-works/pi-tui";
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
	pendingBlockTask: TaskState | null;
	/** Native text input for the active inline prompt; null outside prompt modes. */
	promptInput: Input | null;
	/** Scroll offset for the detail view's long content (description/notes). */
	detailScroll: number;
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
		pendingBlockTask: null,
		promptInput: null,
		detailScroll: 0,
	};
}

/**
 * What the input layer needs from the controller. runOperation serializes
 * board mutations: repeated keys while one operation is pending are
 * rejected, and dispose aborts the running operation's signal.
 */
export interface OverlayInputDeps {
	ui: OverlayActions;
	tasksIn(col: Column): TaskState[];
	selectedTask(): TaskState | undefined;
	requestRender(): void;
	close(): void;
	cycleTheme(): void;
	runOperation(label: string, operation: (signal: AbortSignal) => Promise<void>): void;
}

/** Active board column for the current selection index. */
export function activeColumn(state: OverlayInputState): Column {
	return COLUMNS[state.activeColIdx] ?? "in-progress";
}

/** Enter an inline prompt mode with a native, focused Input. */
export function openPrompt(
	state: OverlayInputState,
	mode: "new-task" | "block-reason",
): void {
	state.promptInput = new Input();
	state.promptInput.focused = true;
	state.mode = mode;
	state.statusMessage = "";
}