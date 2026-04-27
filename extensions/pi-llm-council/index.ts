/**
 * Pi LLM Council extension — multi-model debate and consensus.
 *
 * Wires lifecycle, tool adapters, and slash-command adapters around one
 * explicit session state object. Debate/pairing behavior lives in siblings.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCouncilCommands } from "./commands.js";
import {
	createCouncilExtensionState,
	type CouncilExtensionState,
} from "./extension-state.js";
import { snapshotAvailableModels } from "./members.js";
import { resolveCouncilSettings } from "./settings.js";
import { refreshCouncilStatus } from "./status-bar.js";
import { configuredSlots, defaultSlot } from "./support.js";
import { registerCouncilTools } from "./tools.js";

function initialiseCouncils(state: CouncilExtensionState, snapshot: string[]): void {
	const settings = resolveCouncilSettings();
	state.councils.clear();
	for (const slot of [defaultSlot(snapshot), ...configuredSlots(snapshot, settings)]) {
		state.councils.set(slot.definition.name, slot);
	}
}

export default function (pi: ExtensionAPI) {
	const state = createCouncilExtensionState();

	pi.on("session_start", async (_event, ctx) => {
		initialiseCouncils(state, snapshotAvailableModels(ctx));
		refreshCouncilStatus(ctx, state.councils, state.pairs);
	});

	registerCouncilTools(pi, state);
	registerCouncilCommands(pi, state);
}
