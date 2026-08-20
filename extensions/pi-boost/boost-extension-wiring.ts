/** Thin extension lifecycle wiring for the optional host-owned boost capability. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBoostCommand } from "./boost/command.js";
import {
	createHostBoostCommandDeps,
	createUnavailableBoostCommandDeps,
	type LiveBoostHostInjection,
} from "./boost/runtime-adapter.js";
import type { Registry } from "../pi-panopticon/types.js";

export type { LiveBoostHostInjection } from "./boost/runtime-adapter.js";

export function setupBoostRuntime(
	pi: ExtensionAPI,
	registry: Pick<Registry, "isRootSession" | "selfId">,
	injection?: LiveBoostHostInjection,
): { readonly shutdown: () => Promise<void> } {
	registerBoostCommand(
		pi,
		injection
			? createHostBoostCommandDeps(registry, injection)
			: createUnavailableBoostCommandDeps(registry),
	);
	return {
		shutdown: async () => {
			if (injection) {
				await injection.bridge.shutdown({ choice: injection.shutdownChoice });
			}
		},
	};
}
