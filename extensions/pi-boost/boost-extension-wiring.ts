/** Thin extension lifecycle wiring for the host-owned boost capability and cognitive deliberation. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createCognitiveAuditSink } from "./boost/cognitive-audit.js";
import type { CognitiveAuditSink, CognitiveModelRunner } from "./boost/cognitive-types.js";
import {
	DEFAULT_BOOST_HOST_CAPABILITIES,
	type BoostHostCapabilities,
} from "./boost/host-capabilities.js";
import { registerBoostCommand } from "./boost/command.js";
import { registerBoostFusionTool } from "./boost/fusion-tool.js";
import type { BoostIdentitySource } from "./boost/identity-source.js";
import {
	createHostBoostCommandDeps,
	createUnavailableBoostCommandDeps,
	type LiveBoostHostInjection,
} from "./boost/runtime-adapter.js";

export type { LiveBoostHostInjection } from "./boost/runtime-adapter.js";
interface BoostRuntimeOptions {
	readonly cognitiveRunner?: CognitiveModelRunner;
	readonly hostCapabilities?: BoostHostCapabilities;
	readonly cognitiveAudit?: CognitiveAuditSink;
}

export function setupBoostRuntime(
	pi: ExtensionAPI,
	identitySource: BoostIdentitySource,
	injection?: LiveBoostHostInjection,
	options: BoostRuntimeOptions = {},
): { readonly shutdown: () => Promise<void> } {
	const { cognitiveRunner } = options;
	const hostCapabilities = options.hostCapabilities ?? DEFAULT_BOOST_HOST_CAPABILITIES;
	const cognitiveAudit = options.cognitiveAudit ?? createCognitiveAuditSink();
	const cognitiveOptions = { runner: cognitiveRunner, hostCapabilities, audit: cognitiveAudit };
	const commandDeps = injection
		? createHostBoostCommandDeps(identitySource, injection, cognitiveOptions)
		: createUnavailableBoostCommandDeps(identitySource, cognitiveOptions);
	registerBoostCommand(pi, commandDeps);
	registerBoostFusionTool(pi, identitySource, {
		runner: cognitiveRunner,
		hostCapabilities,
		audit: cognitiveAudit,
	});
	return {
		shutdown: async () => {
			if (injection) {
				await injection.bridge.shutdown({ choice: injection.shutdownChoice });
			}
		},
	};
}
