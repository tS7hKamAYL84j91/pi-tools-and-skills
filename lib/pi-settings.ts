/**
 * Pi settings reader — central helper for ~/.pi/agent/settings.json.
 *
 * Each extension's settings reader independently re-implemented the
 * same try/catch + JSON.parse + key-extract pattern. This module provides
 * the single helper; callers narrow/validate the unknown result.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PI_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

/**
 * Read a top-level key from a pi settings JSON file.
 * Returns `undefined` if the file is missing, unreadable, malformed, or the key
 * is absent. Caller validates the shape of the returned `unknown`.
 */
export function readPiSettingsKey(
	key: string,
	path: string = PI_SETTINGS_PATH,
): unknown {
	try {
		if (!existsSync(path)) return undefined;
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return parsed[key];
	} catch {
		return undefined;
	}
}
