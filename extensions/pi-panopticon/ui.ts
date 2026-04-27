/**
 * UI module for pi-panopticon extension.
 *
 * Wires alias controls, list-mode controls, the agent overlay, and the compact
 * Powerline status widget. Rendering and command details live in sibling files.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerAgentsCommand } from "./agents-command.js";
import { registerAliasControls } from "./alias-command.js";
import type { AgentListModeStore } from "./list-mode.js";
import { registerAgentListModeControls } from "./list-mode-command.js";
import { createAgentStatusWidget, type UIModule } from "./status-widget.js";
import type { Registry } from "./types.js";

export function setupUI(
	pi: ExtensionAPI,
	registry: Registry,
	selfId: string,
	listMode: AgentListModeStore,
): UIModule {
	registerAliasControls(pi, registry);
	registerAgentListModeControls(pi, registry, listMode);
	registerAgentsCommand(pi, registry, selfId, listMode);
	return createAgentStatusWidget(registry, selfId, listMode);
}
