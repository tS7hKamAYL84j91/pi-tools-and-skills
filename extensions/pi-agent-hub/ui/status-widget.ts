/**
 * Agent panopticon status widget refresh logic.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentListModeStore } from "./list-mode.js";
import type { Registry } from "../types.js";
import { filterAgentList } from "../registry/visibility.js";
import { renderStatusWidget } from "./ui-format.js";
import { summarizeAgentStatus } from "./status-view-model.js";

export interface UIModule {
	start(ctx: ExtensionContext): void;
	stop(): void;
	refresh(ctx: ExtensionContext): void;
}

export function createAgentStatusWidget(
	registry: Registry,
	selfId: string,
	listMode: AgentListModeStore,
): UIModule {
	let widgetTimer: ReturnType<typeof setInterval> | null = null;

	function refreshWidget(ctx: ExtensionContext): void {
		try {
			const self = registry.getRecord();
			const records = filterAgentList(self, registry.readAllPeers(), listMode.get(self));
			if (records.length === 0) {
				ctx.ui.setWidget("agent-panopticon", undefined);
				ctx.ui.setStatus("agent-panopticon", ctx.ui.theme.fg("dim", "agents: 0"));
				return;
			}

			ctx.ui.setWidget(
				"agent-panopticon",
				(_tui: unknown, theme: ExtensionContext["ui"]["theme"]) => ({
					render(width: number): string[] {
						return renderStatusWidget(records, selfId, theme, width);
					},
					invalidate(): void {
						// Data refreshed every 5s via refreshWidget timer.
					},
				}),
				{ placement: "belowEditor" },
			);

			ctx.ui.setStatus(
				"agent-panopticon",
				ctx.ui.theme.fg("accent", `agents: ${summarizeAgentStatus(records, selfId).label}`),
			);
		} catch {
			ctx.ui.setStatus("agent-panopticon", ctx.ui.theme.fg("error", "agents: err"));
		}
	}

	return {
		start(ctx: ExtensionContext): void {
			refreshWidget(ctx);
			widgetTimer = setInterval(() => refreshWidget(ctx), 5_000);
		},

		stop(): void {
			if (widgetTimer) {
				clearInterval(widgetTimer);
				widgetTimer = null;
			}
		},

		refresh(ctx: ExtensionContext): void {
			refreshWidget(ctx);
		},
	};
}
