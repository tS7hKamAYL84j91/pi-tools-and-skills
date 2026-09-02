/** Human and agent controls for automatic kanban watcher follow-ups. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";

interface WatcherControl {
	setEnabled: (enabled: boolean) => void;
	getStatus: () => string;
	isEnabled: () => boolean;
}

/** Register the human and agent controls for automatic watcher follow-ups. */
export function registerWatcherControls(
	pi: ExtensionAPI,
	control: WatcherControl,
): void {
	pi.registerCommand("kanban-watch", {
		description: "Enable or disable automatic kanban board follow-ups",
		handler: async (args, commandCtx) => {
			const action = args.trim().toLowerCase();
			if (action === "on" || action === "off") {
				control.setEnabled(action === "on");
				commandCtx.ui.notify(
					`Kanban watcher follow-ups: ${control.getStatus()}`,
					"info",
				);
				return;
			}
			commandCtx.ui.notify(
				`Kanban watcher follow-ups are ${control.getStatus()}. Usage: /kanban-watch on|off`,
				"info",
			);
		},
	});

	pi.registerTool({
		name: "kanban_watch",
		label: "Kanban Watcher",
		description:
			"Enable, disable, or inspect automatic kanban board-change follow-up injection. Widget updates always remain enabled.",
		promptSnippet: "Control automatic kanban board-change follow-ups",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("on"),
				Type.Literal("off"),
				Type.Literal("status"),
			]),
		}),
		async execute(_id, params): Promise<ToolResult> {
			if (params.action !== "status") {
				control.setEnabled(params.action === "on");
			}
			const status = control.getStatus();
			return ok(`Kanban watcher follow-ups: ${status}`, {
				action: params.action,
				enabled: control.isEnabled(),
				widgetUpdates: true,
			});
		},
	});
}
