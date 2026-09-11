/** Persisted settings for Panopticon reconciliation follow-up notifications. */

import { join } from "node:path";
import {
	PI_SETTINGS_PATH,
	readPiSettingsKey,
	savePiSettingsBlock,
} from "../../../lib/pi-settings.js";

interface ReconcilerSettings {
	reconciliationNotifications: boolean;
}

export type ReconcilerSettingsScope = "global" | "project";

const DEFAULT_SETTINGS: ReconcilerSettings = {
	reconciliationNotifications: false,
};

function readSettings(path: string): Partial<ReconcilerSettings> {
	const value = readPiSettingsKey("panopticon", path);
	if (!value || typeof value !== "object") return {};
	const record = value as Record<string, unknown>;
	return typeof record.reconciliationNotifications === "boolean"
		? { reconciliationNotifications: record.reconciliationNotifications }
		: {};
}

export function resolveReconcilerSettings(
	cwd: string,
	isProjectTrusted: boolean,
	customGlobalPath: string = PI_SETTINGS_PATH,
): ReconcilerSettings {
	const global = readSettings(customGlobalPath);
	const project = isProjectTrusted
		? readSettings(join(cwd, ".pi", "settings.json"))
		: {};
	return { ...DEFAULT_SETTINGS, ...global, ...project };
}

export async function saveReconcilerSetting(
	scope: ReconcilerSettingsScope,
	enabled: boolean,
	cwd: string,
	customGlobalPath: string = PI_SETTINGS_PATH,
): Promise<void> {
	const path =
		scope === "global" ? customGlobalPath : join(cwd, ".pi", "settings.json");
	await savePiSettingsBlock(
		"panopticon",
		(block) => {
			block.reconciliationNotifications = enabled;
		},
		path,
	);
}
