/**
 * Agent list overlay command and shortcut registrations.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { openAgentOverlay } from "../ui/agent-overlay.js";
import type { AgentOverlayDeps } from "../ui/agent-overlay-types.js";
import { sortRecords, STATUS_SYMBOL } from "../registry/record-utils.js";
import { filterAgentList } from "../registry/visibility.js";
import { STATUS_LABEL } from "../ui/ui-format.js";

export function registerAgentsCommand(
	pi: ExtensionAPI,
	deps: AgentOverlayDeps,
): void {
	pi.registerCommand("agents", {
		description: "Show compact status bar for all agents, then open detail overlay",
		handler: async (_args, ctx) => {
			const self = deps.registry.getRecord();
			const records = filterAgentList(self, deps.registry.readAllPeers(), deps.listMode.get(self));
			if (records.length === 0) {
				ctx.ui.notify("No agents registered", "info");
				return;
			}
			ctx.ui.notify(
				sortRecords(records, deps.selfId)
					.map((r) => `${STATUS_SYMBOL[r.status]} ${r.name}:${STATUS_LABEL[r.status]}`)
					.join(" | "),
				"info",
			);
			await openAgentOverlay(ctx, deps);
		},
	});

	pi.registerShortcut("ctrl+shift+o", {
		description: "Open agent panopticon overlay",
		handler: async (ctx) => {
			await openAgentOverlay(ctx, deps);
		},
	});
}
