/** Team settings loaded from team roots. */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PI_SETTINGS_PATH } from "../../lib/pi-settings.js";
import { readMarkdownDescriptors } from "./front-matter.js";
import { DEFAULT_CONFIG_JSON, teamDirectories } from "./team-paths.js";
import type { TeamAgentBinding, TeamDirectories, TeamModels } from "./team-types.js";

const SETTINGS_JSON = PI_SETTINGS_PATH;
const FALLBACK_DEFAULT_TEAM_NAME = "default";
const DEFAULT_DEBATE_TEAM_ID = "default-debate";
const DEFAULT_CONSULT_TEAM_ID = "consult";

type PromptCatalog = Record<string, string[]>;

interface TeamDefault {
	name: string;
	description?: string;
	models: TeamModels;
}

interface ResolvedTeamSettings {
	prompts: PromptCatalog;
	defaultMembers: string[];
	defaultSynthesis: string;
	defaultDebate: { name: string; members: string[]; synthesis: string; purpose?: string };
	synthesisCandidates: string[];
	defaultConsult?: { name: string; navigator: string; purpose?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
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

function parseMarkdownPrompt(raw: string): { id: string; lines: string[] } | undefined {
	const normalized = raw.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---\n")) return undefined;
	const end = normalized.indexOf("\n---\n", 4);
	if (end < 0) return undefined;
	const id = frontMatterPromptId(normalized.slice(4, end));
	if (!id) return undefined;
	const body = normalized.slice(end + "\n---\n".length).replace(/\n$/, "");
	const lines = body.split("\n");
	return lines.length > 0 ? { id, lines } : undefined;
}

function readMarkdownPrompts(promptDir: string): PromptCatalog {
	const result: PromptCatalog = {};
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
			// Ignore unreadable prompt files; validation catches missing ids at run time.
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
	const synthesis = bindings.find((binding) => roleMatches(binding.role, ["synthesis"]) && binding.model)?.model;
	const driver = bindings.find((binding) => roleMatches(binding.role, ["driver", "driver_implementation"]) && binding.model)?.model;
	const navigator = bindings.find((binding) => roleMatches(binding.role, ["navigator", "navigator_brief", "navigator_review"]) && binding.model)?.model;
	return {
		...(members.length > 0 ? { members } : {}),
		...(synthesis ? { synthesis } : {}),
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
		roots: settingsPath === SETTINGS_JSON || !existsSync(settingsPath) ? [] : undefined,
	});
}

export function resolveTeamSettings(settingsPath: string = SETTINGS_JSON, extensionConfigPath: string = DEFAULT_CONFIG_JSON): ResolvedTeamSettings {
	const dirs = rootsForSettings(settingsPath, extensionConfigPath);
	const prompts: PromptCatalog = {};
	for (const entry of dirs) Object.assign(prompts, readMarkdownPrompts(entry.prompts), readMarkdownPrompts(entry.agents));
	const teamDefaults = dirs.map((entry) => ({
		debate: readTeamDefault(entry, DEFAULT_DEBATE_TEAM_ID),
		consult: readTeamDefault(entry, DEFAULT_CONSULT_TEAM_ID),
	}));
	const defaultDebate = lastDefined(teamDefaults.map((entry) => entry.debate));
	const defaultConsult = lastDefined(teamDefaults.map((entry) => entry.consult));
	const members = defaultDebate?.models.members ?? [];
	const synthesis = defaultDebate?.models.synthesis ?? members[0] ?? "";
	const consultNavigator = defaultConsult?.models.navigator;
	const defaultDebateSettings = {
		name: defaultDebate?.name ?? FALLBACK_DEFAULT_TEAM_NAME,
		members,
		synthesis,
		...(defaultDebate?.description ? { purpose: defaultDebate.description } : {}),
	};
	const defaultConsultSettings = consultNavigator
		? {
				name: defaultConsult?.name ?? DEFAULT_CONSULT_TEAM_ID,
				navigator: consultNavigator,
				...(defaultConsult?.description ? { purpose: defaultConsult.description } : {}),
			}
		: undefined;
	return {
		prompts,
		defaultMembers: members,
		defaultSynthesis: synthesis,
		defaultDebate: defaultDebateSettings,
		synthesisCandidates: [synthesis, ...members].filter((model, index, values) => model.length > 0 && values.indexOf(model) === index),
		...(defaultConsultSettings ? { defaultConsult: defaultConsultSettings } : {}),
	};
}

const EXTENSION_DEFAULT_SETTINGS = resolveTeamSettings("/nonexistent/pi-settings.json", DEFAULT_CONFIG_JSON);

export const DEFAULT_MEMBER_CANDIDATES = EXTENSION_DEFAULT_SETTINGS.defaultMembers;
export const DEFAULT_SYNTHESIS_CANDIDATES = EXTENSION_DEFAULT_SETTINGS.synthesisCandidates;
