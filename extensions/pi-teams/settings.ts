/**
 * Team prompt settings loaded from team roots.
 *
 * Built-in defaults live under `config/{teams,agents,prompts}`. User/project
 * overrides are selected by top-level `teams.roots` in settings.json.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PI_SETTINGS_PATH } from "../../lib/pi-settings.js";
import { readMarkdownDescriptors } from "./front-matter.js";
import {
	DEFAULT_CONFIG_JSON,
	DEFAULT_USER_TEAM_ROOT,
	teamDirectories,
} from "./team-paths.js";
import type { TeamAgentBinding, TeamDirectories, TeamModels } from "./team-types.js";

const SETTINGS_JSON = PI_SETTINGS_PATH;
const FALLBACK_DEFAULT_COUNCIL_NAME = "default";
const DEFAULT_COUNCIL_TEAM_ID = "default-council";
const DEFAULT_PAIR_TEAM_ID = "pair-consult";

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
	"telephoneRelaySystem",
	"telephoneRelayTemplate",
	"teamGraphNodeTemplate",
] as const;

type PromptKey = (typeof PROMPT_KEYS)[number];

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
	telephoneRelaySystem?: string[];
	telephoneRelayTemplate?: string[];
	teamGraphNodeTemplate?: string[];
}

interface TeamDefault {
	name: string;
	description?: string;
	models: TeamModels;
}

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
export interface ResolvedCouncilSettings {
	prompts: Required<SettingsPromptsEntry>;
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

function isPromptKey(value: string): value is PromptKey {
	return PROMPT_KEYS.some((key) => key === value);
}

function unquoteFrontMatterValue(value: string): string {
	const trimmed = value.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function frontMatterPromptId(frontMatter: string): string | undefined {
	for (const key of ["promptId", "id"]) {
		for (const line of frontMatter.split("\n")) {
			const match = new RegExp(`^${key}:\\s*(.+)$`).exec(line);
			if (match?.[1]) return unquoteFrontMatterValue(match[1]);
		}
	}
	return undefined;
}

function parseMarkdownPrompt(raw: string): { id: PromptKey; lines: string[] } | undefined {
	const normalized = raw.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---\n")) return undefined;
	const end = normalized.indexOf("\n---\n", 4);
	if (end < 0) return undefined;
	const id = frontMatterPromptId(normalized.slice(4, end));
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
			const parsed = parseMarkdownPrompt(readFileSync(join(promptDir, file), "utf8"));
			if (parsed) result[parsed.id] = parsed.lines;
		} catch {
			// Ignore unreadable prompt files; tests cover shipped defaults.
		}
	}
	return result;
}

function roleMatches(role: string, candidates: string[]): boolean {
	const normalized = role.toLowerCase().replaceAll("-", "_");
	return candidates.some((candidate) => normalized === candidate || normalized.startsWith(`${candidate}_`));
}

function bindingObjects(value: unknown): TeamAgentBinding[] {
	if (!Array.isArray(value)) return [];
	return value.filter(isRecord).flatMap((entry) => {
		const role = optionalString(entry.role);
		const subagent = optionalString(entry.subagent);
		if (!role || !subagent) return [];
		const model = optionalString(entry.model);
		return [{ role, subagent, ...(model ? { model } : {}) }];
	});
}

function modelsFromBindings(bindings: TeamAgentBinding[]): TeamModels {
	const members = bindings
		.filter((binding) => roleMatches(binding.role, ["member", "relay"]) && binding.model)
		.map((binding) => binding.model as string);
	const chairman = bindings.find((binding) => roleMatches(binding.role, ["chairman", "chair"]) && binding.model)?.model;
	const driver = bindings.find((binding) => roleMatches(binding.role, ["driver"]) && binding.model)?.model;
	const navigator = bindings.find((binding) => roleMatches(binding.role, ["navigator"]) && binding.model)?.model;
	return {
		...(members.length > 0 ? { members } : {}),
		...(chairman ? { chairman } : {}),
		...(driver ? { driver } : {}),
		...(navigator ? { navigator } : {}),
	};
}

function readTeamDefault(dirs: TeamDirectories, teamId: string): TeamDefault | undefined {
	const descriptor = readMarkdownDescriptors(dirs.teams).find((entry) => optionalString(entry.frontMatter.id) === teamId);
	if (!descriptor) return undefined;
	return {
		name: optionalString(descriptor.frontMatter.name) ?? teamId,
		...(optionalString(descriptor.frontMatter.description) ? { description: optionalString(descriptor.frontMatter.description) } : {}),
		models: modelsFromBindings(bindingObjects(descriptor.frontMatter.agents)),
	};
}

function requiredPrompts(prompts: SettingsPromptsEntry): Required<SettingsPromptsEntry> {
	const result: SettingsPromptsEntry = {};
	for (const key of PROMPT_KEYS) result[key] = prompts[key] ?? [];
	return result as Required<SettingsPromptsEntry>;
}

function lastDefined<T>(values: Array<T | undefined>): T | undefined {
	for (let index = values.length - 1; index >= 0; index--) {
		const value = values[index];
		if (value !== undefined) return value;
	}
	return undefined;
}

function rootsForSettings(settingsPath: string, extensionConfigPath: string): TeamDirectories[] {
	return teamDirectories(extensionConfigPath, {
		settingsPath,
		roots: settingsPath === "/nonexistent/pi-settings.json" ? [DEFAULT_USER_TEAM_ROOT] : undefined,
	});
}

export function resolveCouncilSettings(
	settingsPath: string = SETTINGS_JSON,
	extensionConfigPath: string = DEFAULT_CONFIG_JSON,
): ResolvedCouncilSettings {
	const dirs = rootsForSettings(settingsPath, extensionConfigPath);
	const promptDefaults: SettingsPromptsEntry = {};
	for (const entry of dirs) {
		Object.assign(
			promptDefaults,
			readMarkdownPrompts(entry.prompts),
			readMarkdownPrompts(entry.agents),
		);
	}
	const teamDefaults = dirs.map((entry) => ({
		council: readTeamDefault(entry, DEFAULT_COUNCIL_TEAM_ID),
		pair: readTeamDefault(entry, DEFAULT_PAIR_TEAM_ID),
	}));
	const defaultCouncil = lastDefined(teamDefaults.map((entry) => entry.council));
	const defaultPair = lastDefined(teamDefaults.map((entry) => entry.pair));
	const members = defaultCouncil?.models.members ?? [];
	const chairman = defaultCouncil?.models.chairman ?? members[0] ?? "";
	const pairNavigator = defaultPair?.models.navigator;
	return {
		defaultMembers: members,
		defaultChairman: chairman,
		defaultCouncil: {
			name: defaultCouncil?.name ?? FALLBACK_DEFAULT_COUNCIL_NAME,
			members,
			chairman,
			...(defaultCouncil?.description ? { purpose: defaultCouncil.description } : {}),
		},
		chairmanCandidates: [chairman, ...members].filter((model, index, values) => model.length > 0 && values.indexOf(model) === index),
		...(pairNavigator
			? {
					defaultPair: {
						name: defaultPair?.name ?? DEFAULT_PAIR_TEAM_ID,
						navigator: pairNavigator,
						...(defaultPair?.description ? { purpose: defaultPair.description } : {}),
					},
				}
			: {}),
		councils: {},
		pairs: {},
		prompts: requiredPrompts(promptDefaults),
	};
}

const EXTENSION_DEFAULT_SETTINGS = resolveCouncilSettings(
	"/nonexistent/pi-settings.json",
	DEFAULT_CONFIG_JSON,
);

/** The visible default member list from the built-in default-council team. */
export const DEFAULT_MEMBER_CANDIDATES = EXTENSION_DEFAULT_SETTINGS.defaultMembers;

/** Chairman fallback candidates from built-in team definitions. */
export const DEFAULT_CHAIRMAN_CANDIDATES = EXTENSION_DEFAULT_SETTINGS.chairmanCandidates;

