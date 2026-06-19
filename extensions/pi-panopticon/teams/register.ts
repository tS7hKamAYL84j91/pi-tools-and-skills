/**
 * Panopticon teams module — declarative team specs for team work.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { omitEmptyTools } from "./provider-payload.js";
import { TeamStateManager } from "./state.js";
import { registerTeamCommands } from "./team-commands.js";
import { registerTeamRunTool } from "./team-runtime.js";
import { registerTeamSessionMode } from "./team-session-mode.js";
import { registerTeamTools } from "./team-tools.js";

export function registerTeams(pi: ExtensionAPI) {
	const stateManager = new TeamStateManager({
		appendEntry: (customType, data) => pi.appendEntry(customType, data),
	});

	pi.on("before_provider_request", (event) => omitEmptyTools(event.payload));
	pi.on("session_start", (_event, ctx) => stateManager.rehydrateFromSession(ctx.sessionManager));
	pi.on("session_tree", (_event, ctx) => stateManager.rehydrateFromSession(ctx.sessionManager));

	registerTeamTools(pi);
	registerTeamRunTool(pi, { stateManager });
	registerTeamCommands(pi, { stateManager });
	registerTeamSessionMode(pi);
}

