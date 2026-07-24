/** Swarm feature wiring. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RuntimeControlPlane } from "../../../lib/runtime-control-plane.js";
import { registerSwarmCommand } from "./swarm-commands.js";
import { createSwarmWorkerAdapter, SwarmRunner } from "./swarm-runner.js";
import { registerSwarmTools } from "./swarm-tools.js";

interface SwarmModule {
	shutdown(): Promise<void>;
}

/** Registers the bounded worker-pool tools and command. */
export default function setupSwarm(
	pi: ExtensionAPI,
	selfId: string,
	runtime: RuntimeControlPlane,
): SwarmModule {
	const runner = new SwarmRunner(createSwarmWorkerAdapter(selfId));
	registerSwarmTools(pi, { runner, runtime });
	registerSwarmCommand(pi, runner);
	return { shutdown: async () => runner.shutdown() };
}
