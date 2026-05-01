/**
 * Kanban Extension — Entry Point
 *
 * Registers the kanban watcher, commands, shortcuts, and tool groups.
 * Board state, snapshot rendering, watcher, and compaction logic live in
 * sibling modules; this file preserves activation order only.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerBoardTools } from "./board-tools.js";
import { registerClaimTools } from "./claim-tools.js";
import { registerMaintenanceTools } from "./maintenance-tools.js";
import { registerTaskTools } from "./task-tools.js";
import { setupWatcher } from "./watcher.js";

export default function (pi: ExtensionAPI) {
	setupWatcher(pi);
	registerTaskTools(pi);
	registerClaimTools(pi);
	registerBoardTools(pi);
	registerMaintenanceTools(pi);
}
