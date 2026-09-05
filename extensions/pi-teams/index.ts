/** pi-teams extension entrypoint. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { RuntimeControlPlane } from "../../lib/runtime-control-plane.js";
import { registerTeams } from "./register.js";

/** Register retained consult, debate, and research team workflows. */
export default function (pi: ExtensionAPI): void {
	registerTeams(pi, new RuntimeControlPlane());
}
