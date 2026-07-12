/**
 * Panopticon teams module — declarative team specs for team work.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { RuntimeControlPlane } from "../../../lib/runtime-control-plane.js";
import { omitEmptyTools } from "./provider-payload.js";
import { TeamStateManager } from "./state.js";
import { registerTeamCommands } from "./team-commands.js";
import { projectBuiltinTeams } from "./team-projection.js";
import { registerTeamRunTool } from "./team-runtime.js";
import { registerTeamSessionMode } from "./team-session-mode.js";
import { registerTeamTools } from "./team-tools.js";

export function registerTeams(pi: ExtensionAPI) {
	const stateManager = new TeamStateManager({
		appendEntry: (customType, data) => pi.appendEntry(customType, data),
	});
	const runtime = new RuntimeControlPlane();

	pi.on("before_provider_request", (event) => omitEmptyTools(event.payload));
	pi.on("session_start", async (event, ctx) => {
		stateManager.rehydrateFromSession(ctx.sessionManager);
		// Project built-in team seeds into the user scope on a fresh startup so
		// the live ~/.pi copy becomes the editable source of truth. Startup-only
		// (not reload/new/resume/fork) to respect intentional user deletions; use
		// /teams seed to re-project after an upgrade. See ADR 026.
		if (event.reason === "startup") {
			const result = await projectBuiltinTeams(ctx);
			if (result.projected.length > 0) {
				ctx.ui.notify(
					`Projected ${result.projected.length} built-in team${result.projected.length === 1 ? "" : "s"} to ~/.pi/agent/teams: ${result.projected.join(", ")}. Edit them or run /teams seed.`,
					"info",
				);
			}
		}
	});
	pi.on("session_tree", (_event, ctx) => stateManager.rehydrateFromSession(ctx.sessionManager));

	registerTeamTools(pi);
	registerTeamRunTool(pi, { stateManager, runtime });
	registerTeamCommands(pi, { stateManager, runtime });
	registerTeamSessionMode(pi, { stateManager, runtime });
}

