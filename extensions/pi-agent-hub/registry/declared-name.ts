/**
 * Declared canonical-name resolution for COAS-managed agents.
 *
 * The office manifest renders `automationsProfile.panopticonName` into the
 * project `.pi/settings.json` at launch. That is trusted launch metadata —
 * unlike an LLM-chosen set_name — so it seeds the registry's canonical name
 * without depending on the model renaming itself.
 *
 * The declared name applies only to root agents: spawned supporting agents
 * carry PI_PANOPTICON_SPAWN_NAME from the trusted spawner and must not claim
 * the project's lead label (a prefix is not authority).
 */

import { join } from "node:path";
import { readPiSettingsKey } from "../../../lib/pi-settings.js";
import { isValidAgentName } from "../../../lib/agent-registry.js";

/** Read the declared panopticon name from the project settings, if any. */
export function readDeclaredName(cwd: string): string | undefined {
	try {
		const profile = readPiSettingsKey(
			"automationsProfile",
			join(cwd, ".pi", "settings.json"),
		);
		if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
			return undefined;
		}
		const raw = (profile as Record<string, unknown>).panopticonName;
		if (typeof raw !== "string") return undefined;
		const name = raw.trim();
		return isValidAgentName(name) ? name : undefined;
	} catch {
		return undefined;
	}
}