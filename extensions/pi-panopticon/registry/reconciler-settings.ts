/** Persisted settings for Panopticon reconciliation follow-up notifications. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withAdvisoryLock } from "../../../lib/file-lock.js";
import { writeFileAtomic } from "../../../lib/file-persistence.js";
import {
	PI_SETTINGS_PATH,
	readPiSettingsKey,
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
			// Preserve the safe fallback for malformed settings files.
		}
		const current =
			existing.panopticon && typeof existing.panopticon === "object"
				? (existing.panopticon as Record<string, unknown>)
				: {};
		await writeFileAtomic(
			path,
			`${JSON.stringify(
				{
					...existing,
					panopticon: { ...current, reconciliationNotifications: enabled },
				},
				null,
				2,
			)}\n`,
			{ mode: 0o600 },
		);
	});
}
