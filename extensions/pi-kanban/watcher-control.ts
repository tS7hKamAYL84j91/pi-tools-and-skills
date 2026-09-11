/** Human and agent controls for automatic kanban watcher follow-ups. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { registerToggleCommand, type ToggleControl } from "../../lib/toggle-command.js";
import { ok, type ToolResult } from "../../lib/tool-result.js";

interface WatcherControl extends ToggleControl {
	isEnabled: () => boolean;
}

/** Register the human and agent controls for automatic watcher follow-ups. */
export function registerWatcherControls(
	pi: ExtensionAPI,
	control: WatcherControl,
): void {
	registerToggleCommand(
		pi,
		{
			name: "kanban-watch",
			description: "Enable or disable automatic kanban board follow-ups",
			label: "Kanban watcher follow-ups",
			settingsLabel: "kanban watcher",
		},
		control,
	);

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
				await control.setEnabled(params.action === "on");
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
