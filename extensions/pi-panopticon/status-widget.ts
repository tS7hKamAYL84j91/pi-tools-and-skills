/**
 * Agent panopticon status and powerline widget refresh logic.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentListModeStore } from "./list-mode.js";
import type { Registry } from "./types.js";
import { filterAgentList } from "./visibility.js";
import { renderPowerlineWidget } from "./ui-format.js";

export interface UIModule {
	start(ctx: ExtensionContext): void;
	stop(): void;
	refresh(ctx: ExtensionContext): void;
}

function agentStatusLabel(records: ReturnType<typeof filterAgentList>, selfId: string): string {
	const peers = records.filter((r) => r.id !== selfId);
	const running = peers.filter((r) => r.status === "running").length;
	const waiting = peers.filter((r) => r.status === "waiting").length;
	if (peers.length === 0) return "solo";
	if (running > 0 || waiting > 0) {
		return [[running, "▶"], [waiting, "⏸"]]
			.filter(([n]) => n)
			.map(([n, s]) => `${n}${s}`)
			.join(" ");
	}
	return `${peers.length} peer${peers.length !== 1 ? "s" : ""}`;
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
						return renderPowerlineWidget(records, selfId, theme, width);
					},
					invalidate(): void {
						// Data refreshed every 5s via refreshWidget timer.
					},
				}),
				{ placement: "belowEditor" },
			);

			ctx.ui.setStatus(
				"agent-panopticon",
				ctx.ui.theme.fg("accent", `⚡${agentStatusLabel(records, selfId)}`),
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
