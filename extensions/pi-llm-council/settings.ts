/**
 * Council settings — visible defaults from extension config plus user overrides.
 *
 * Defaults live in `extensions/pi-llm-council/config.json` so the default
 * council, chairman candidates, and pair are reviewable without spelunking
 * TypeScript. User `~/.pi/agent/settings.json` may still override fields via
 * the `council` key.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PI_SETTINGS_PATH, readPiSettingsKey } from "../../lib/pi-settings.js";

const SETTINGS_JSON = PI_SETTINGS_PATH;
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_JSON = join(EXTENSION_DIR, "config.json");
const FALLBACK_DEFAULT_COUNCIL_NAME = "default";

/** @public */
export interface SettingsCouncilEntry {
	members?: string[];
	chairman?: string;
	purpose?: string;
}

/** @public */
export interface SettingsDefaultCouncilEntry extends SettingsCouncilEntry {
	name?: string;
}

/** @public */
export interface SettingsPairEntry {
	navigator?: string;
	purpose?: string;
}

/** @public */
export interface SettingsDefaultPairEntry extends SettingsPairEntry {
	name?: string;
}

/** @public */
export interface CouncilSettings {
	defaultMembers?: string[];
	defaultChairman?: string;
	defaultCouncil?: SettingsDefaultCouncilEntry;
	chairmanCandidates?: string[];
	defaultPair?: SettingsDefaultPairEntry;
	councils?: Record<string, SettingsCouncilEntry>;
	pairs?: Record<string, SettingsPairEntry>;
}

/** @public */
export interface ResolvedCouncilSettings {
	defaultMembers: string[];
	defaultChairman: string;
	defaultCouncil: Required<Pick<SettingsDefaultCouncilEntry, "name" | "members" | "chairman">> & { purpose?: string };
	chairmanCandidates: string[];
	defaultPair?: Required<Pick<SettingsDefaultPairEntry, "name" | "navigator">> & { purpose?: string };
	councils: Record<string, SettingsCouncilEntry>;
	pairs: Record<string, SettingsPairEntry>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const values = value.map(optionalString).filter((item): item is string => item !== undefined);
	return values.length > 0 ? values : undefined;
}

function councilEntry(value: unknown): SettingsCouncilEntry | undefined {
	if (!isRecord(value)) return undefined;
	return {
		...(stringArray(value.members) ? { members: stringArray(value.members) } : {}),
		...(optionalString(value.chairman) ? { chairman: optionalString(value.chairman) } : {}),
		...(optionalString(value.purpose) ? { purpose: optionalString(value.purpose) } : {}),
	};
}

function defaultCouncilEntry(value: unknown): SettingsDefaultCouncilEntry | undefined {
	const entry = councilEntry(value);
	if (!isRecord(value) || !entry) return entry;
	return {
		...entry,
		...(optionalString(value.name) ? { name: optionalString(value.name) } : {}),
	};
}

function pairEntry(value: unknown): SettingsPairEntry | undefined {
	if (!isRecord(value)) return undefined;
	return {
		...(optionalString(value.navigator) ? { navigator: optionalString(value.navigator) } : {}),
		...(optionalString(value.purpose) ? { purpose: optionalString(value.purpose) } : {}),
	};
}

function defaultPairEntry(value: unknown): SettingsDefaultPairEntry | undefined {
	const entry = pairEntry(value);
	if (!isRecord(value) || !entry) return entry;
	return {
		...entry,
		...(optionalString(value.name) ? { name: optionalString(value.name) } : {}),
	};
}

function entryRecord<T>(value: unknown, parse: (entry: unknown) => T | undefined): Record<string, T> | undefined {
	if (!isRecord(value)) return undefined;
	const result: Record<string, T> = {};
	for (const [name, entryValue] of Object.entries(value)) {
		const parsed = parse(entryValue);
		if (parsed) result[name] = parsed;
	}
	return result;
}

function normaliseCouncilSettings(value: unknown): CouncilSettings {
	if (!isRecord(value)) return {};
	return {
		...(stringArray(value.defaultMembers) ? { defaultMembers: stringArray(value.defaultMembers) } : {}),
		...(optionalString(value.defaultChairman) ? { defaultChairman: optionalString(value.defaultChairman) } : {}),
		...(defaultCouncilEntry(value.defaultCouncil) ? { defaultCouncil: defaultCouncilEntry(value.defaultCouncil) } : {}),
		...(stringArray(value.chairmanCandidates) ? { chairmanCandidates: stringArray(value.chairmanCandidates) } : {}),
		...(defaultPairEntry(value.defaultPair) ? { defaultPair: defaultPairEntry(value.defaultPair) } : {}),
		...(entryRecord(value.councils, councilEntry) ? { councils: entryRecord(value.councils, councilEntry) } : {}),
		...(entryRecord(value.pairs, pairEntry) ? { pairs: entryRecord(value.pairs, pairEntry) } : {}),
	};
}

function readExtensionDefaults(path: string = DEFAULT_CONFIG_JSON): CouncilSettings {
	try {
		return normaliseCouncilSettings(JSON.parse(readFileSync(path, "utf8")) as unknown);
	} catch {
		return {};
	}
}

/** Read the council section of ~/.pi/agent/settings.json. Returns {} if missing/invalid. */
function readCouncilSettings(path: string = SETTINGS_JSON): CouncilSettings {
	return normaliseCouncilSettings(readPiSettingsKey("council", path));
}

function resolveDefaultCouncil(extensionDefaults: CouncilSettings, user: CouncilSettings): ResolvedCouncilSettings["defaultCouncil"] {
	const config = {
		...extensionDefaults.defaultCouncil,
		...user.defaultCouncil,
	};
	const members =
		user.defaultMembers ??
		config.members ??
		extensionDefaults.defaultMembers ??
		[];
	const chairman =
		user.defaultChairman ??
		config.chairman ??
		extensionDefaults.defaultChairman ??
		members[0] ??
		"";
	return {
		name: config.name ?? FALLBACK_DEFAULT_COUNCIL_NAME,
		members,
		chairman,
		...(config.purpose ? { purpose: config.purpose } : {}),
	};
}

function resolveDefaultPair(extensionDefaults: CouncilSettings, user: CouncilSettings): ResolvedCouncilSettings["defaultPair"] {
	const config = {
		...extensionDefaults.defaultPair,
		...user.defaultPair,
	};
	if (!config.name || !config.navigator) return undefined;
	return {
		name: config.name,
		navigator: config.navigator,
		...(config.purpose ? { purpose: config.purpose } : {}),
	};
}

/**
 * Resolve council settings with field-level defaults.
 *
 * User settings override visible extension defaults per field, so partial
 * config still gets sane defaults for unspecified values.
 */
export function resolveCouncilSettings(
	settingsPath: string = SETTINGS_JSON,
	extensionConfigPath: string = DEFAULT_CONFIG_JSON,
): ResolvedCouncilSettings {
	const extensionDefaults = readExtensionDefaults(extensionConfigPath);
	const user = readCouncilSettings(settingsPath);
	const defaultCouncil = resolveDefaultCouncil(extensionDefaults, user);
	const defaultPair = resolveDefaultPair(extensionDefaults, user);
	const pairs = {
		...(extensionDefaults.pairs ?? {}),
		...(defaultPair ? { [defaultPair.name]: defaultPair } : {}),
		...(user.pairs ?? {}),
	};
	return {
		defaultMembers: defaultCouncil.members,
		defaultChairman: defaultCouncil.chairman,
		defaultCouncil,
		chairmanCandidates: user.chairmanCandidates ?? extensionDefaults.chairmanCandidates ?? [],
		...(defaultPair ? { defaultPair } : {}),
		councils: {
			...(extensionDefaults.councils ?? {}),
			...(user.councils ?? {}),
		},
		pairs,
	};
}

const EXTENSION_DEFAULT_SETTINGS = resolveCouncilSettings("/nonexistent/pi-settings.json");

/** The visible default member list from extensions/pi-llm-council/config.json. */
export const DEFAULT_MEMBER_CANDIDATES = EXTENSION_DEFAULT_SETTINGS.defaultMembers;

/** Chairman fallback candidates from extensions/pi-llm-council/config.json. */
export const DEFAULT_CHAIRMAN_CANDIDATES = EXTENSION_DEFAULT_SETTINGS.chairmanCandidates;
