/**
 * CoAS Extension — pi control surface for the CoAS runtime repo.
 *
 * Wraps ~/git/coas operator scripts as typed tools and commands, and adds
 * lightweight workspace context guidance inside pi sessions.
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
