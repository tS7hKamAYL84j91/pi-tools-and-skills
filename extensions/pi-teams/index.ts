/** pi-teams extension entrypoint. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { RuntimeControlPlane } from "../../lib/runtime-control-plane.js";
import setupSwarm from "./swarm/index.js";
import { registerTeams } from "./register.js";

/** Register Teams and its swarm compatibility aliases as one package. */
export default function (pi: ExtensionAPI): void {
	const teams = registerTeams(pi, new RuntimeControlPlane());
	setupSwarm(pi, teams);
}
