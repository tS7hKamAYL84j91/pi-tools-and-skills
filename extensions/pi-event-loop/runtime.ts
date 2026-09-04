/** Live session-scoped runtime state for pi-event-loop (SPEC §11, §14, §17). */

import { EMPTY_PROJECTION, type TodoProjection } from "./projector.js";
import type { CommandRecord, TodoItem } from "./types.js";

/** Mutable state that lives for the lifetime of one extension instance; persisted state lives in the session log. */
export interface EventLoopRuntime {
	/** Command currently delivered to the agent, if any. */
	activeCommand: CommandRecord | undefined;
	/** Work item belonging to the active command, if any. */
	activeWorkItem: TodoItem | undefined;
	/** Live todo projection over the session event history (SPEC §9). */
	projection: TodoProjection;
	/** Session-local FIFO command queue (SPEC §11). */
	queue: readonly CommandRecord[];
	/** Whether an agent turn is running. */
	busy: boolean;
	/** Consecutive event-loop-triggered turns without manual user input. */
	consecutiveAutomatedTurns: number;
	/** Whether automated delivery is paused, with the operator-visible reason. */
	paused: boolean;
	pauseReason: string | undefined;
}

export function createEventLoopRuntime(): EventLoopRuntime {
	return {
		activeCommand: undefined,
		activeWorkItem: undefined,
		projection: EMPTY_PROJECTION,
		queue: [],
		busy: false,
		consecutiveAutomatedTurns: 0,
		paused: false,
		pauseReason: undefined,
	};
}
