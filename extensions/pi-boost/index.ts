/** Standalone Principal-only boost extension. */
import type {ExtensionFactory} from "@earendil-works/pi-coding-agent";
import {setupBoostRuntime, type LiveBoostHostInjection} from "./boost-extension-wiring.js";
import type {Registry} from "../pi-panopticon/types.js";

export function createBoostExtension(
	injection?: LiveBoostHostInjection,
	registry?: Pick<Registry, "isRootSession" | "selfId">,
): ExtensionFactory {
	return (pi) => {
		const lifecycle = setupBoostRuntime(pi, registry ?? {
			isRootSession: () => true,
			selfId: `principal-${process.pid}`,
		}, injection);
		pi.on("session_shutdown", async () => lifecycle.shutdown());
	};
}

const extension = createBoostExtension();
export default extension;
