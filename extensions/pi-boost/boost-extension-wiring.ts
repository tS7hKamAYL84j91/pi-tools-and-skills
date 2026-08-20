/** Thin extension lifecycle wiring for the optional host-owned boost capability. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBoostCommand } from "./boost/command.js";
import {
	createHostBoostCommandDeps,
	createUnavailableBoostCommandDeps,
	type LiveBoostHostInjection,
} from "./boost/runtime-adapter.js";
import type { BoostIdentitySource } from "./boost/identity-source.js";

export type { LiveBoostHostInjection } from "./boost/runtime-adapter.js";

export function setupBoostRuntime(
	pi: ExtensionAPI,
	identitySource: BoostIdentitySource,
	injection?: LiveBoostHostInjection,
): { readonly shutdown: () => Promise<void> } {
	registerBoostCommand(
		pi,
		injection
			? createHostBoostCommandDeps(identitySource, injection)
			: createUnavailableBoostCommandDeps(identitySource),
	);
	return {
		shutdown: async () => {
			if (injection) {
				await injection.bridge.shutdown({ choice: injection.shutdownChoice });
			}
		},
	};
}
