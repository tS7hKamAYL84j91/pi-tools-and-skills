/** Schedule telemetry log appender. */

import { join } from "node:path";
import { ConfinedStore } from "./store.js";
import { assertSafeId, isoUtc, scheduleLogRoot } from "./store-paths.js";
import type { AutomationsConfig } from "./types.js";

export async function appendScheduleLog(config: AutomationsConfig, taskId: string, message: string): Promise<void> {
	assertSafeId("task id", taskId);
	const homeStore = await ConfinedStore.createAutomationsHome(config);
	const root = scheduleLogRoot(config);
	await homeStore.ensurePrivateDir(root);
	const store = await ConfinedStore.forScheduleLogRoot(config);
	await store.appendPrivateLog(join(root, `${taskId}.log`), `[${isoUtc()}] ${message}\n`);
}
