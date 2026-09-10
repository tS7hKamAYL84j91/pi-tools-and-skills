/**
 * Kanban overlay board-mode keys: navigation, filter entry, and the
 * action keys that open dialogs or dispatch shared board actions.
 * Submode handling lives in overlay-input.ts.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import { COLUMNS } from "./overlay-model.js";
import {
	claimFromOverlay,
	completeFromOverlay,
	unblockFromOverlay,
} from "./overlay-actions.js";
import { selectedTaskId } from "./overlay-selection.js";
import {
	activeColumn,
	type OverlayInputDeps,
	type OverlayInputState,
	openPrompt,
} from "./overlay-input-state.js";

export function handleBoardKey(
	state: OverlayInputState,
	deps: OverlayInputDeps,
	data: string,
): void {
	if (matchesKey(data, "escape") || matchesKey(data, "q")) {
		deps.close();
		return;
	}

	// Status messages are transient: any new board key clears them.
	state.statusMessage = "";

	if (matchesKey(data, "/")) {
		state.filterSelectionId = selectedTaskId(
			deps.tasksIn(activeColumn(state)),
			state.activeRow,
		);
		state.mode = "search";
		return;
	}

	if (matchesKey(data, "n")) {
		openPrompt(state, "new-task");
		return;
	}

	if (matchesKey(data, "t")) {
		deps.cycleTheme();
		return;
	}

	if (matchesKey(data, "c")) {
		deps.runOperation("claim", () =>
			claimFromOverlay(deps.ui, deps.selectedTask()),
		);
		return;
	}

	if (matchesKey(data, "x")) {
		const task = deps.selectedTask();
		if (!task) return;
		deps.runOperation("complete", (signal) =>
			completeFromOverlay(deps.ui, task, signal),
		);
		return;
	}

	if (matchesKey(data, "b")) {
		const task = deps.selectedTask();
		if (!task) return;
		state.pendingBlockTask = task;
		openPrompt(state, "block-reason");
		return;
	}

	if (matchesKey(data, "u")) {
		const task = deps.selectedTask();
		if (!task) return;
		deps.runOperation("unblock", () => unblockFromOverlay(deps.ui, task));
		return;
	}

	if (matchesKey(data, "d")) {
		const task = deps.selectedTask();
		if (!task) return;
		if (task.col === "in-progress") {
			state.statusMessage = "Delete unavailable: complete the task first";
			deps.requestRender();
			return;
		}
		state.pendingDeleteTask = task;
		state.mode = "confirm-delete";
		return;
	}

	if (matchesKey(data, "m")) {
		const task = deps.selectedTask();
		if (!task) return;
		if (task.col !== "backlog" && task.col !== "todo") {
			state.statusMessage = `Move unavailable: ${task.col} tasks cannot be moved`;
			deps.requestRender();
			return;
		}
		state.pendingMoveTask = task;
		state.movePickerIndex = task.col === "todo" ? 1 : 0;
		state.mode = "move-picker";
		return;
	}

	if (matchesKey(data, "left") || matchesKey(data, "shift+tab")) {
		state.activeColIdx =
			(state.activeColIdx + COLUMNS.length - 1) % COLUMNS.length;
		state.activeRow = 0;
		return;
	}

	if (matchesKey(data, "right") || matchesKey(data, "tab")) {
		state.activeColIdx = (state.activeColIdx + 1) % COLUMNS.length;
		state.activeRow = 0;
		return;
	}

	if (matchesKey(data, "up")) {
		if (state.activeRow > 0) state.activeRow--;
		return;
	}

	if (matchesKey(data, "down")) {
		const tasks = deps.tasksIn(activeColumn(state));
		if (state.activeRow < tasks.length - 1) state.activeRow++;
		return;
	}

	if (matchesKey(data, "enter") || matchesKey(data, "return")) {
		if (deps.selectedTask()) {
			state.mode = "detail";
			state.detailScroll = 0;
		}
	}
}