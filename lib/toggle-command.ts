/**
 * Reusable toggle slash-command registration helper.
 *
 * Implements the standard /<name> on|off|status convention across extensions.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface ToggleControl {
	setEnabled: (enabled: boolean) => Promise<void>;
	getStatus: () => string;
	isEnabled?: () => boolean;
}

export interface RegisterToggleOptions {
	name: string;
	description: string;
	label: string;
	settingsLabel?: string;
}

/**
 * Register a standardized toggle slash command (/name on|off).
 */
export function registerToggleCommand(
	pi: ExtensionAPI,
	options: RegisterToggleOptions,
	control: ToggleControl,
): void {
	const { name, description, label, settingsLabel = label } = options;

	pi.registerCommand(name, {
		description,
		handler: async (args, commandCtx) => {
			const action = args.trim().toLowerCase();
			if (action === "on" || action === "off") {
				try {
					await control.setEnabled(action === "on");
				} catch {
					commandCtx.ui.notify(
						`Unable to persist ${settingsLabel} settings.`,
						"error",
					);
					return;
				}
				commandCtx.ui.notify(
					`${label}: ${control.getStatus()}`,
					"info",
				);
				return;
			}
			commandCtx.ui.notify(
				`${label} are ${control.getStatus()}. Usage: /${name} on|off`,
				"info",
			);
		},
	});
}
