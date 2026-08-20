/** Standalone Principal-only Boost extension. */

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { PANOPTICON_PARENT_ID_ENV } from "../../lib/agent-registry.js";
import type { BoostIdentitySource } from "./boost/identity-source.js";
import {
	setupBoostRuntime,
	type LiveBoostHostInjection,
} from "./boost-extension-wiring.js";

/** Create Boost with an optional host capability and explicit identity boundary. */
export function createBoostExtension(
	injection?: LiveBoostHostInjection,
	identitySource: BoostIdentitySource = createDefaultIdentitySource(),
): ExtensionFactory {
	return (pi) => {
		const lifecycle = setupBoostRuntime(pi, identitySource, injection);
		pi.on("session_shutdown", async () => lifecycle.shutdown());
	};
}

function createDefaultIdentitySource(): BoostIdentitySource {
	return {
		selfId: `principal-${process.pid}`,
		isPrincipalSession: () =>
			process.env.PI_PRINCIPAL === "1" &&
			process.env[PANOPTICON_PARENT_ID_ENV] === undefined,
	};
}

const extension = createBoostExtension();
export default extension;
