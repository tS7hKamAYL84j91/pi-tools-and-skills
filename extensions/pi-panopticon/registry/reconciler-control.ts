/** Runtime controls for Panopticon reconciliation follow-up notifications. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface ReconcilerControl {
	setEnabled: (enabled: boolean) => Promise<void>;
	getStatus: () => string;
}

/** Register the slash command and tool for the reconciler notification toggle. */
export function registerReconcilerControls(
	pi: ExtensionAPI,
	control: ReconcilerControl,
): void {
	pi.registerCommand("panopticon-reconcile", {
		description: "Enable or disable Panopticon reconciliation follow-ups",
		handler: async (args, commandCtx) => {
			const action = args.trim().toLowerCase();
			if (action === "on" || action === "off") {
				try {
					await control.setEnabled(action === "on");
				} catch {
					commandCtx.ui.notify(
						"Unable to persist Panopticon reconciliation settings.",
						"error",
					);
					return;
				}
				commandCtx.ui.notify(
					`Panopticon reconciliation follow-ups: ${control.getStatus()}`,
					"info",
				);
				return;
			}
			commandCtx.ui.notify(
				`Panopticon reconciliation follow-ups are ${control.getStatus()}. Usage: /panopticon-reconcile on|off`,
				"info",
			);
		},
	});
}
