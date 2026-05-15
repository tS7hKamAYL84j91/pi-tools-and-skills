/**
 * UI module for pi-panopticon extension.
 *
 * Wires naming tools, list-mode controls, the agent overlay, and the compact
 * status widget. Rendering and command details live in sibling files.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentOverlayDeps } from "./agent-overlay-types.js";
import { registerAgentsCommand } from "./agents-command.js";
import { registerNameControls } from "./name-controls.js";
import { registerAgentListModeControls } from "./list-mode-command.js";
import { createAgentStatusWidget, type UIModule } from "./status-widget.js";

export function setupUI(
	pi: ExtensionAPI,
	deps: AgentOverlayDeps,
): UIModule {
	registerNameControls(pi, deps.registry);
	registerAgentListModeControls(pi, deps.registry, deps.listMode);
	registerAgentsCommand(pi, deps);
	return createAgentStatusWidget(deps.registry, deps.selfId, deps.listMode);
}
