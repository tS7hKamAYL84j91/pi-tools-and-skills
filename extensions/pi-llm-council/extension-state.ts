/**
 * Explicit runtime state for the Pi LLM Council extension.
 */

import type { PairDefinition } from "./pair-commands.js";
import type { CouncilSlot } from "./status-bar.js";
import { CouncilStateManager } from "./state.js";

export interface CouncilExtensionState {
	// Mutate maps in place; registrars close over these identities.
	councils: Map<string, CouncilSlot>;
	pairs: Map<string, PairDefinition>;
	stateManager: CouncilStateManager;
}

export function createCouncilExtensionState(): CouncilExtensionState {
	return {
		councils: new Map<string, CouncilSlot>(),
		pairs: new Map<string, PairDefinition>(),
		stateManager: new CouncilStateManager(),
	};
}
