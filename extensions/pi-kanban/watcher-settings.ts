/** Persisted settings for kanban watcher follow-up notifications. */

import { join } from "node:path";
import {
	PI_SETTINGS_PATH,
	readPiSettingsKey,
	savePiSettingsBlock,
} from "../../lib/pi-settings.js";

interface WatcherSettings {
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
	await savePiSettingsBlock(
		"kanban",
		(block) => {
			block.watchNotifications = enabled;
		},
		path,
	);
}
