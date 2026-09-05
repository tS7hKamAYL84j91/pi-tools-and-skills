/**
 * CoAS Extension — pi control surface for the CoAS runtime repo.
 *
 * Provides TypeScript-native CoAS workspace, pi-scheduler, status, and
 * diagnostics tools without depending on a sibling CoAS checkout.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCoasCommands } from "./commands.js";
import { registerCoasLifecycle } from "./lifecycle.js";
import { PiScheduler } from "./pi-scheduler.js";
import { registerCoasTools } from "./tools.js";

export default function (pi: ExtensionAPI) {
	const scheduler = new PiScheduler(pi);
	registerCoasLifecycle(pi, scheduler);
	registerCoasTools(pi, scheduler);
	registerCoasCommands(pi, scheduler);
}
