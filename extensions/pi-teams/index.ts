/**
 * Pi LLM Teams extension — declarative team specs for council and pair work.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { omitEmptyTools } from "./provider-payload.js";
import { CouncilStateManager } from "./state.js";
import { ensureUserTeamDefaults } from "./team-defaults.js";
import { registerTeamCommands } from "./team-commands.js";
import { registerTeamRunTool } from "./team-runtime.js";
import { registerTeamTools } from "./team-tools.js";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));

export default function (pi: ExtensionAPI) {
	ensureUserTeamDefaults();
	const stateManager = new CouncilStateManager(undefined, {
		appendEntry: (customType, data) => pi.appendEntry(customType, data),
	});

	pi.on("resources_discover", () => ({
		promptPaths: [join(EXTENSION_DIR, "config", "prompts")],
	}));
	pi.on("before_provider_request", (event) => omitEmptyTools(event.payload));

	registerTeamTools(pi);
	registerTeamRunTool(pi, { stateManager });
	registerTeamCommands(pi, { stateManager });
}
