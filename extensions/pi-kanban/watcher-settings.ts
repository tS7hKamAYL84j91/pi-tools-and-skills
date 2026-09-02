/** Persisted settings for kanban watcher follow-up notifications. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withAdvisoryLock } from "../../lib/file-lock.js";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { PI_SETTINGS_PATH, readPiSettingsKey } from "../../lib/pi-settings.js";

export interface WatcherSettings {
	watchNotifications: boolean;
}

export type WatcherSettingsScope = "global" | "project";

const DEFAULT_SETTINGS: WatcherSettings = { watchNotifications: false };

function readSettings(path: string): Partial<WatcherSettings> {
	const value = readPiSettingsKey("kanban", path);
	if (!value || typeof value !== "object") return {};
	const record = value as Record<string, unknown>;
	return typeof record.watchNotifications === "boolean"
		? { watchNotifications: record.watchNotifications }
		: {};
}

export function resolveWatcherSettings(
	cwd: string,
	isProjectTrusted: boolean,
	customGlobalPath: string = PI_SETTINGS_PATH,
): WatcherSettings {
	const global = readSettings(customGlobalPath);
	const project = isProjectTrusted
		? readSettings(join(cwd, ".pi", "settings.json"))
		: {};
	return {
		...DEFAULT_SETTINGS,
		...global,
		...project,
	};
}

export async function saveWatcherSetting(
	scope: WatcherSettingsScope,
	enabled: boolean,
	cwd: string,
	customGlobalPath: string = PI_SETTINGS_PATH,
): Promise<void> {
	const path =
		scope === "global" ? customGlobalPath : join(cwd, ".pi", "settings.json");
	await withAdvisoryLock(path, async () => {
		let existing: Record<string, unknown> = {};
		try {
			if (existsSync(path)) {
				const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
				if (parsed && typeof parsed === "object") {
					existing = parsed as Record<string, unknown>;
				}
			}
		} catch {
			// Start with an empty settings object when the file is malformed.
		}
		const current =
			existing.kanban && typeof existing.kanban === "object"
				? (existing.kanban as Record<string, unknown>)
				: {};
		await writeFileAtomic(
			path,
			`${JSON.stringify({ ...existing, kanban: { ...current, watchNotifications: enabled } }, null, 2)}\n`,
			{ mode: 0o600 },
		);
	});
}
