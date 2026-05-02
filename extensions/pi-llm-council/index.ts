/**
 * Pi LLM Teams extension — declarative team specs for council and pair work.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { omitEmptyTools } from "./provider-payload.js";
import { CouncilStateManager } from "./state.js";
import { registerTeamRunTool } from "./team-runtime.js";
import { registerTeamTools } from "./teams.js";

export default function (pi: ExtensionAPI) {
	const stateManager = new CouncilStateManager();

	pi.on("before_provider_request", (event) => omitEmptyTools(event.payload));

	registerTeamTools(pi);
	registerTeamRunTool(pi, { stateManager });
}
