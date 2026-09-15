/**
 * Automations Extension — pi control surface for the Automations runtime repo.
 *
 * Provides TypeScript-native Automations workspace, pi-scheduler, status, and
 * diagnostics tools without depending on a sibling Automations checkout.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAutomationsCommands } from "./commands.js";
import { registerAutomationsLifecycle } from "./lifecycle.js";
import { PiScheduler } from "./pi-scheduler.js";
import { registerAutomationsTools } from "./tools.js";

export default function (pi: ExtensionAPI) {
	const scheduler = new PiScheduler(pi);
	registerAutomationsLifecycle(pi, scheduler);
	registerAutomationsTools(pi, scheduler);
	registerAutomationsCommands(pi, scheduler);
}
