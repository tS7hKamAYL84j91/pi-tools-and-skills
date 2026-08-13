/**
 * Panopticon teams module — declarative team specs for team work.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { RuntimeControlPlane } from "../../../lib/runtime-control-plane.js";
import { omitEmptyTools } from "./provider-payload.js";
import { TeamStateManager } from "./state.js";
import { registerTeamCommands } from "./team-commands.js";
import { projectBuiltinTeams } from "./team-projection.js";
import { registerTeamRunTool, runTeam } from "./team-runtime.js";
import type { TeamRunToolResult } from "./team-run-completion.js";
import { startTeamRunAsync } from "./team-async.js";
import type { TeamRunInput } from "./team-handlers.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerTeamSessionMode } from "./team-session-mode.js";
import { registerTeamTools } from "./team-tools.js";

export interface TeamsFacade {
	stateManager: TeamStateManager;
	runtime: RuntimeControlPlane;
	run(params: TeamRunInput, ctx: ExtensionContext): Promise<TeamRunToolResult>;
	runAsync(params: TeamRunInput, ctx: ExtensionContext): ReturnType<typeof startTeamRunAsync>;
}

export function registerTeams(pi: ExtensionAPI, sharedRuntime?: RuntimeControlPlane): TeamsFacade {
	const stateManager = new TeamStateManager({
		appendEntry: (customType, data) => pi.appendEntry(customType, data),
	});
	const runtime = sharedRuntime ?? new RuntimeControlPlane();

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
	return {
		stateManager,
		runtime,
		run(params, ctx) {
			return runTeam({ params, ctx, stateManager, runtime });
		},
		runAsync(params, ctx) {
			return startTeamRunAsync({
				pi,
				params,
				ctx,
				run: (runParams, resultRoot) => runTeam({ params: runParams, ctx, stateManager, runtime, resultRoot }) as Promise<TeamRunToolResult>,
			});
		},
	};
}

