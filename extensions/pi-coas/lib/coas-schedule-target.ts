/** Minimal schedule-env reader for cross-extension consumers. */

import { join } from "node:path";
import { ConfinedStore } from "../../../lib/confined-store.js";
import type { CoasConfig } from "../../../lib/coas-types.js";

function unquoteShellValue(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/'"'"'/g, "'");
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1).replace(/\\"/g, '"');
	return trimmed;
}

export async function readScheduleTargetAgent(config: CoasConfig, taskId: string): Promise<string | undefined> {
	const store = await ConfinedStore.openRoot(config.coasHome);
	if (!store) return undefined;
	const envPath = join(config.coasHome, "schedules", `${taskId}.env`);
	const raw = await store.readOptionalFile(envPath);
	if (raw === undefined) return undefined;
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const index = trimmed.indexOf("=");
		if (index <= 0) continue;
		const key = trimmed.slice(0, index);
		if (key === "TARGET_AGENT") return unquoteShellValue(trimmed.slice(index + 1));
	}
	return undefined;
}
