/**
 * Schedule telemetry log appender.
 */
import { mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { appendLogLine } from "../../lib/file-persistence.js";
import { isoUtc, scheduleLogRoot } from "./store.js";
import type { CoasConfig } from "./types.js";

export async function appendScheduleLog(
	config: CoasConfig,
	taskId: string,
	message: string,
): Promise<void> {
	const root = scheduleLogRoot(config);
	await mkdir(root, { recursive: true, mode: 0o700 });
	const path = join(root, `${taskId}.log`);
	await appendLogLine(path, `[${isoUtc()}] ${message}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await chmod(path, 0o600).catch(() => undefined);
}
