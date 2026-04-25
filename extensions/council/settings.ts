/**
 * Council settings — read configured councils from ~/.pi/agent/settings.json.
 *
 * Settings shape:
 *   {
 *     "council": {
 *       "defaultMembers": ["openai/gpt-5.5", "anthropic/claude-opus-4-6", ...],
 *       "defaultChairman": "google/gemini-2.5-pro",
 *       "councils": {
 *         "architecture": { "members": [...], "chairman": "...", "purpose": "..." }
 *       }
 *     }
 *   }
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SETTINGS_JSON = join(homedir(), ".pi", "agent", "settings.json");

/** @public */
export interface SettingsCouncilEntry {
	members?: string[];
	chairman?: string;
	purpose?: string;
}

/** @public */
export interface CouncilSettings {
	defaultMembers?: string[];
	defaultChairman?: string;
	councils?: Record<string, SettingsCouncilEntry>;
}

interface PiSettingsFile {
	council?: CouncilSettings;
}

/** Read the council section of ~/.pi/agent/settings.json. Returns {} if missing/invalid. */
export function readCouncilSettings(
	path: string = SETTINGS_JSON,
): CouncilSettings {
	try {
		if (!existsSync(path)) return {};
		const raw = readFileSync(path, "utf-8");
		const settings = JSON.parse(raw) as PiSettingsFile;
		return settings.council ?? {};
	} catch {
		return {};
	}
}
