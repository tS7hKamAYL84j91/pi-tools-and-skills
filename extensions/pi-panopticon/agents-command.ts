/**
 * Agent list overlay command and shortcut registrations.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AgentListModeStore } from "./list-mode.js";
import { sortRecords, STATUS_SYMBOL } from "./registry.js";
import type { Registry } from "./types.js";
import { filterAgentList } from "./visibility.js";
import { openAgentOverlay } from "./agent-overlay.js";
import { PL_SEP_THIN, STATUS_LABEL } from "./ui-format.js";

export function registerAgentsCommand(
	pi: ExtensionAPI,
	registry: Registry,
	selfId: string,
	listMode: AgentListModeStore,
): void {
	pi.registerCommand("agents", {
		description: "Show compact Powerline status bar for all agents, then open detail overlay",
		handler: async (_args, ctx) => {
			const self = registry.getRecord();
			const records = filterAgentList(self, registry.readAllPeers(), listMode.get(self));
			if (records.length === 0) {
				ctx.ui.notify("No agents registered", "info");
				return;
			}
			ctx.ui.notify(
				sortRecords(records, selfId)
					.map((r) => `${STATUS_SYMBOL[r.status]} ${r.name}:${STATUS_LABEL[r.status]}`)
					.join(` ${PL_SEP_THIN} `),
				"info",
			);
			await openAgentOverlay(ctx, selfId, registry, listMode);
		},
	});

	pi.registerShortcut("ctrl+shift+o", {
		description: "Open agent panopticon overlay",
		handler: async (ctx) => {
			await openAgentOverlay(ctx, selfId, registry, listMode);
		},
	});
}
