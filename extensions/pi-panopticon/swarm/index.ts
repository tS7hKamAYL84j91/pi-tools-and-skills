/** ADR-040 compatibility wiring for legacy swarm entry points. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TeamsFacade } from "../teams/register.js";
import { registerSwarmCommand } from "./swarm-commands.js";
import { registerSwarmTools } from "./swarm-tools.js";

interface SwarmModule {
	shutdown(): Promise<void>;
}

/** Registers legacy aliases through the canonical Teams lifecycle only. */
export default function setupSwarm(pi: ExtensionAPI, teams: TeamsFacade): SwarmModule {
	registerSwarmTools(pi, { teams });
	registerSwarmCommand(pi, teams);
	return { shutdown: async () => {} };
}
