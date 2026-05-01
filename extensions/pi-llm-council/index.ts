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
import { omitEmptyTools } from "./provider-payload.js";
import { resolveCouncilSettings, type ResolvedCouncilSettings } from "./settings.js";
import { refreshCouncilStatus } from "./status-bar.js";
import { configuredSlots, defaultSlot } from "./support.js";
import { registerCouncilTools } from "./tools.js";

function initialiseCouncils(state: CouncilExtensionState, snapshot: string[], settings: ResolvedCouncilSettings): void {
	state.councils.clear();
	for (const slot of [defaultSlot(snapshot, settings), ...configuredSlots(snapshot, settings)]) {
		state.councils.set(slot.definition.name, slot);
	}
}

function initialisePairs(state: CouncilExtensionState, settings: ResolvedCouncilSettings): void {
	state.pairs.clear();
	for (const [name, pair] of Object.entries(settings.pairs)) {
		if (!pair.navigator) continue;
		state.pairs.set(name, {
			name,
			navigator: pair.navigator,
			...(pair.purpose ? { purpose: pair.purpose } : {}),
			createdAt: Date.now(),
		});
	}
}

export default function (pi: ExtensionAPI) {
	const state = createCouncilExtensionState();

	pi.on("session_start", async (_event, ctx) => {
		const settings = resolveCouncilSettings();
		initialiseCouncils(state, snapshotAvailableModels(ctx), settings);
		initialisePairs(state, settings);
		refreshCouncilStatus(ctx, state.councils, state.pairs);
	});

	pi.on("before_provider_request", (event) => omitEmptyTools(event.payload));

	registerCouncilTools(pi, state);
	registerCouncilCommands(pi, state);
}
