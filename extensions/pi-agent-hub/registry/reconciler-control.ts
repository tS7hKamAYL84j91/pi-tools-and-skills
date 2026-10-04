/** Runtime controls for Panopticon reconciliation follow-up notifications. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerToggleCommand, type ToggleControl } from "../../../lib/toggle-command.js";

type ReconcilerControl = ToggleControl;

/** Register the slash command and tool for the reconciler notification toggle. */
export function registerReconcilerControls(
	pi: ExtensionAPI,
	control: ReconcilerControl,
): void {
	registerToggleCommand(
		pi,
		{
			name: "panopticon-reconcile",
			description: "Enable or disable Panopticon reconciliation follow-ups",
			label: "Panopticon reconciliation follow-ups",
			settingsLabel: "Panopticon reconciliation",
		},
		control,
	);
}
