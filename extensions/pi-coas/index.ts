/**
 * CoAS Extension — pi control surface for the CoAS runtime repo.
 *
 * Provides TypeScript-native CoAS workspace, schedule, status, and doctor
 * tools without depending on a sibling CoAS checkout.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCoasCommands } from "./commands.js";
import { registerCoasLifecycle } from "./lifecycle.js";
import { registerCoasTools } from "./tools.js";

export default function (pi: ExtensionAPI) {
	registerCoasLifecycle(pi);
	registerCoasTools(pi);
	registerCoasCommands(pi);
}
