/** pi-teams extension entrypoint. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTeams } from "./register.js";

/** Register retained consult, debate, and research team workflows. */
export default function (pi: ExtensionAPI): void {
	registerTeams(pi);
}
