/**
 * Council settings — visible defaults from extension config plus user overrides.
 *
 * Defaults live in `extensions/pi-llm-council/config/config.json`; prompt bodies
 * live as Markdown files with front matter under `extensions/pi-llm-council/config/prompts/`.
 * User `~/.pi/agent/settings.json` may still override fields via the `council`
 * key.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PI_SETTINGS_PATH, readPiSettingsKey } from "../../lib/pi-settings.js";

const SETTINGS_JSON = PI_SETTINGS_PATH;
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_JSON = join(EXTENSION_DIR, "config", "config.json");
const FALLBACK_DEFAULT_COUNCIL_NAME = "default";
const DEFAULT_PROMPT_DIRECTORY = "prompts";

const PROMPT_KEYS = [
	"councilGenerationSystem",
	"councilCritiqueSystem",
	"councilChairmanSystem",
	"councilCritiqueTemplate",
	"councilSynthesisTemplate",
	"pairNavigatorBriefSystem",
	"pairDriverImplementationSystem",
	"pairNavigatorConsultSystem",
	"pairNavigatorReviewSystem",
	"pairDriverFixSystem",
	"pairNavigatorBriefTemplate",
	"pairDriverImplementationTemplate",
	"pairNavigatorReviewTemplate",
	"pairDriverFixTemplate",
	"pairPrimer",
	"agentCouncilFraming",
	"agentPairConsultFraming",
	"agentRequestTemplate",
] as const;

type PromptKey = (typeof PROMPT_KEYS)[number];

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
export interface SettingsPromptsEntry {
	councilGenerationSystem?: string[];
	councilCritiqueSystem?: string[];
	councilChairmanSystem?: string[];
	councilCritiqueTemplate?: string[];
	councilSynthesisTemplate?: string[];
	pairNavigatorBriefSystem?: string[];
	pairDriverImplementationSystem?: string[];
	pairNavigatorConsultSystem?: string[];
	pairNavigatorReviewSystem?: string[];
	pairDriverFixSystem?: string[];
	pairNavigatorBriefTemplate?: string[];
	pairDriverImplementationTemplate?: string[];
	pairNavigatorReviewTemplate?: string[];
	pairDriverFixTemplate?: string[];
	pairPrimer?: string[];
	agentCouncilFraming?: string[];
	agentPairConsultFraming?: string[];
	agentRequestTemplate?: string[];
}

interface CouncilSettings {
	prompts?: SettingsPromptsEntry;
	promptDirectory?: string;
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
	prompts: Required<SettingsPromptsEntry>;
	defaultMembers: string[];
	defaultChairman: string;
	defaultCouncil: Required<
		Pick<SettingsDefaultCouncilEntry, "name" | "members" | "chairman">
	> & { purpose?: string };
	chairmanCandidates: string[];
	defaultPair?: Required<
		Pick<SettingsDefaultPairEntry, "name" | "navigator">
	> & { purpose?: string };
	councils: Record<string, SettingsCouncilEntry>;
	pairs: Record<string, SettingsPairEntry>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

function stringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const values = value
		.map(optionalString)
		.filter((item): item is string => item !== undefined);
	return values.length > 0 ? values : undefined;
}

function promptStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const values = value.filter(
		(item): item is string => typeof item === "string",
	);
	return values.length > 0 ? values : undefined;
}

function councilEntry(value: unknown): SettingsCouncilEntry | undefined {
	if (!isRecord(value)) return undefined;
	return {
		...(stringArray(value.members)
			? { members: stringArray(value.members) }
			: {}),
		...(optionalString(value.chairman)
			? { chairman: optionalString(value.chairman) }
			: {}),
		...(optionalString(value.purpose)
			? { purpose: optionalString(value.purpose) }
			: {}),
	};
}

function defaultCouncilEntry(
	value: unknown,
): SettingsDefaultCouncilEntry | undefined {
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
		...(optionalString(value.navigator)
			? { navigator: optionalString(value.navigator) }
			: {}),
		...(optionalString(value.purpose)
			? { purpose: optionalString(value.purpose) }
			: {}),
	};
}

function defaultPairEntry(
	value: unknown,
): SettingsDefaultPairEntry | undefined {
	const entry = pairEntry(value);
	if (!isRecord(value) || !entry) return entry;
	return {
		...entry,
		...(optionalString(value.name) ? { name: optionalString(value.name) } : {}),
	};
}

function entryRecord<T>(
	value: unknown,
	parse: (entry: unknown) => T | undefined,
): Record<string, T> | undefined {
	if (!isRecord(value)) return undefined;
	const result: Record<string, T> = {};
	for (const [name, entryValue] of Object.entries(value)) {
		const parsed = parse(entryValue);
		if (parsed) result[name] = parsed;
	}
	return result;
}

function promptsEntry(value: unknown): SettingsPromptsEntry | undefined {
	if (!isRecord(value)) return undefined;
	const result: SettingsPromptsEntry = {};
	for (const key of PROMPT_KEYS) {
		const arr = promptStringArray(value[key]);
		if (arr) result[key] = arr;
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

function isPromptKey(value: string): value is PromptKey {
	return PROMPT_KEYS.some((key) => key === value);
}

function unquoteFrontMatterValue(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function frontMatterId(frontMatter: string): string | undefined {
	for (const line of frontMatter.split("\n")) {
		const match = /^id:\s*(.+)$/.exec(line);
		if (match?.[1]) return unquoteFrontMatterValue(match[1]);
	}
	return undefined;
}

function parseMarkdownPrompt(
	raw: string,
): { id: PromptKey; lines: string[] } | undefined {
	const normalized = raw.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---\n")) return undefined;
	const end = normalized.indexOf("\n---\n", 4);
	if (end < 0) return undefined;
	const id = frontMatterId(normalized.slice(4, end));
	if (!id || !isPromptKey(id)) return undefined;
	const body = normalized.slice(end + "\n---\n".length).replace(/\n$/, "");
	const lines = body.split("\n");
	return lines.length > 0 ? { id, lines } : undefined;
}

function readMarkdownPrompts(promptDir: string): SettingsPromptsEntry {
	const result: SettingsPromptsEntry = {};
	let files: string[];
	try {
		files = readdirSync(promptDir).filter((file) => file.endsWith(".md"));
	} catch {
		return result;
	}
	for (const file of files) {
		try {
			const parsed = parseMarkdownPrompt(
				readFileSync(join(promptDir, file), "utf8"),
			);
			if (parsed) result[parsed.id] = parsed.lines;
		} catch {
			// Ignore unreadable prompt files; tests cover the shipped defaults.
		}
	}
	return result;
}

function normaliseCouncilSettings(value: unknown): CouncilSettings {
	if (!isRecord(value)) return {};
	return {
		...(stringArray(value.defaultMembers)
			? { defaultMembers: stringArray(value.defaultMembers) }
			: {}),
		...(optionalString(value.defaultChairman)
			? { defaultChairman: optionalString(value.defaultChairman) }
			: {}),
		...(defaultCouncilEntry(value.defaultCouncil)
			? { defaultCouncil: defaultCouncilEntry(value.defaultCouncil) }
			: {}),
		...(stringArray(value.chairmanCandidates)
			? { chairmanCandidates: stringArray(value.chairmanCandidates) }
			: {}),
		...(defaultPairEntry(value.defaultPair)
			? { defaultPair: defaultPairEntry(value.defaultPair) }
			: {}),
		...(entryRecord(value.councils, councilEntry)
			? { councils: entryRecord(value.councils, councilEntry) }
			: {}),
		...(entryRecord(value.pairs, pairEntry)
			? { pairs: entryRecord(value.pairs, pairEntry) }
			: {}),
		...(promptsEntry(value.prompts)
			? { prompts: promptsEntry(value.prompts) }
			: {}),
		...(optionalString(value.promptDirectory)
			? { promptDirectory: optionalString(value.promptDirectory) }
			: {}),
	};
}

function readExtensionDefaults(
	path: string = DEFAULT_CONFIG_JSON,
): CouncilSettings {
	try {
		const settings = normaliseCouncilSettings(
			JSON.parse(readFileSync(path, "utf8")) as unknown,
		);
		const promptDir = join(
			dirname(path),
			settings.promptDirectory ?? DEFAULT_PROMPT_DIRECTORY,
		);
		return {
			...settings,
			prompts: {
				...readMarkdownPrompts(promptDir),
				...(settings.prompts ?? {}),
			},
		};
	} catch {
		return {};
	}
}

/** Read the council section of ~/.pi/agent/settings.json. Returns {} if missing/invalid. */
function readCouncilSettings(path: string = SETTINGS_JSON): CouncilSettings {
	return normaliseCouncilSettings(readPiSettingsKey("council", path));
}

function resolveDefaultCouncil(
	extensionDefaults: CouncilSettings,
	user: CouncilSettings,
): ResolvedCouncilSettings["defaultCouncil"] {
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

function resolveDefaultPair(
	extensionDefaults: CouncilSettings,
	user: CouncilSettings,
): ResolvedCouncilSettings["defaultPair"] {
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
function resolvePrompts(
	extensionDefaults: CouncilSettings,
	user: CouncilSettings,
): Required<SettingsPromptsEntry> {
	const userPrompts = user.prompts ?? {};
	const defaultPrompts = extensionDefaults.prompts ?? {};
	return {
		councilGenerationSystem:
			userPrompts.councilGenerationSystem ??
			defaultPrompts.councilGenerationSystem ??
			[],
		councilCritiqueSystem:
			userPrompts.councilCritiqueSystem ??
			defaultPrompts.councilCritiqueSystem ??
			[],
		councilChairmanSystem:
			userPrompts.councilChairmanSystem ??
			defaultPrompts.councilChairmanSystem ??
			[],
		councilCritiqueTemplate:
			userPrompts.councilCritiqueTemplate ??
			defaultPrompts.councilCritiqueTemplate ??
			[],
		councilSynthesisTemplate:
			userPrompts.councilSynthesisTemplate ??
			defaultPrompts.councilSynthesisTemplate ??
			[],
		pairNavigatorBriefSystem:
			userPrompts.pairNavigatorBriefSystem ??
			defaultPrompts.pairNavigatorBriefSystem ??
			[],
		pairDriverImplementationSystem:
			userPrompts.pairDriverImplementationSystem ??
			defaultPrompts.pairDriverImplementationSystem ??
			[],
		pairNavigatorConsultSystem:
			userPrompts.pairNavigatorConsultSystem ??
			defaultPrompts.pairNavigatorConsultSystem ??
			[],
		pairNavigatorReviewSystem:
			userPrompts.pairNavigatorReviewSystem ??
			defaultPrompts.pairNavigatorReviewSystem ??
			[],
		pairDriverFixSystem:
			userPrompts.pairDriverFixSystem ??
			defaultPrompts.pairDriverFixSystem ??
			[],
		pairNavigatorBriefTemplate:
			userPrompts.pairNavigatorBriefTemplate ??
			defaultPrompts.pairNavigatorBriefTemplate ??
			[],
		pairDriverImplementationTemplate:
			userPrompts.pairDriverImplementationTemplate ??
			defaultPrompts.pairDriverImplementationTemplate ??
			[],
		pairNavigatorReviewTemplate:
			userPrompts.pairNavigatorReviewTemplate ??
			defaultPrompts.pairNavigatorReviewTemplate ??
			[],
		pairDriverFixTemplate:
			userPrompts.pairDriverFixTemplate ??
			defaultPrompts.pairDriverFixTemplate ??
			[],
		pairPrimer: userPrompts.pairPrimer ?? defaultPrompts.pairPrimer ?? [],
		agentCouncilFraming:
			userPrompts.agentCouncilFraming ??
			defaultPrompts.agentCouncilFraming ??
			[],
		agentPairConsultFraming:
			userPrompts.agentPairConsultFraming ??
			defaultPrompts.agentPairConsultFraming ??
			[],
		agentRequestTemplate:
			userPrompts.agentRequestTemplate ??
			defaultPrompts.agentRequestTemplate ??
			[],
	};
}

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
		chairmanCandidates:
			user.chairmanCandidates ?? extensionDefaults.chairmanCandidates ?? [],
		...(defaultPair ? { defaultPair } : {}),
		councils: {
			...(extensionDefaults.councils ?? {}),
			...(user.councils ?? {}),
		},
		pairs,
		prompts: resolvePrompts(extensionDefaults, user),
	};
}

const EXTENSION_DEFAULT_SETTINGS = resolveCouncilSettings(
	"/nonexistent/pi-settings.json",
);

/** The visible default member list from extensions/pi-llm-council/config/config.json. */
export const DEFAULT_MEMBER_CANDIDATES =
	EXTENSION_DEFAULT_SETTINGS.defaultMembers;

/** Chairman fallback candidates from extensions/pi-llm-council/config/config.json. */
export const DEFAULT_CHAIRMAN_CANDIDATES =
	EXTENSION_DEFAULT_SETTINGS.chairmanCandidates;
