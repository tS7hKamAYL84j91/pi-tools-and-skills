/**
 * Declarative team specs for the council extension.
 *
 * Team specs describe built-in council and pair workflows. Execution is handled
 * by team-runtime.ts through the standard team_run tool.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readMarkdownDescriptors, type RawMarkdownDescriptor } from "./front-matter.js";
import { chooseChairmanModel, chooseCouncilModels } from "./members.js";
import { resolveCouncilSettings, type ResolvedCouncilSettings } from "./settings.js";
import type { CouncilDefinition } from "./types.js";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_JSON = join(EXTENSION_DIR, "config", "config.json");
const DEFAULT_SUBAGENT_DIRECTORY = "subagents";
const DEFAULT_TEAM_DIRECTORY = "teams";

export type TeamTopology = "council" | "pair";
export type TeamProtocol = "debate" | "consult" | "pair-coding";
export type TeamSource = "builtin";

interface SubagentSpec {
	id: string;
	name: string;
	description?: string;
	promptId?: string;
	path: string;
}

export interface TeamLimits {
	timeoutMs?: number;
	maxFixPasses?: number;
}

export interface TeamSpec {
	schemaVersion: 1;
	id: string;
	name: string;
	description?: string;
	topology: TeamTopology;
	protocol: TeamProtocol;
	agents: string[];
	chair?: string;
	limits: TeamLimits;
	source: TeamSource;
	path: string;
}

interface TeamRegistry {
	teams: Map<string, TeamSpec>;
	subagents: Map<string, SubagentSpec>;
	warnings: string[];
}

interface TeamDirectories {
	subagents: string;
	teams: string;
}

interface PairDefinition {
	name: string;
	navigator: string;
	purpose?: string;
	createdAt: number;
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

function optionalNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string") return undefined;
	const parsed = Number(value.trim());
	return Number.isFinite(parsed) ? parsed : undefined;
}

function readTeamDirectories(configPath: string): TeamDirectories {
	try {
		const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
		const config = isRecord(raw) ? raw : {};
		const configDir = dirname(configPath);
		return {
			subagents: join(
				configDir,
				optionalString(config.subagentDirectory) ?? DEFAULT_SUBAGENT_DIRECTORY,
			),
			teams: join(
				configDir,
				optionalString(config.teamDirectory) ?? DEFAULT_TEAM_DIRECTORY,
			),
		};
	} catch {
		return {
			subagents: join(dirname(configPath), DEFAULT_SUBAGENT_DIRECTORY),
			teams: join(dirname(configPath), DEFAULT_TEAM_DIRECTORY),
		};
	}
}

function descriptorIdFromPath(path: string): string {
	return basename(path, ".md");
}

function isSubagentId(value: string): boolean {
	return /^[a-z][a-z0-9_]*$/.test(value);
}

function toSubagentSpec(descriptor: RawMarkdownDescriptor): SubagentSpec {
	const frontMatter = descriptor.frontMatter;
	const id = optionalString(frontMatter.name) ?? descriptorIdFromPath(descriptor.path);
	const description = optionalString(frontMatter.description);
	const promptId = optionalString(frontMatter.promptId);
	return {
		id,
		name: id,
		...(description ? { description } : {}),
		...(promptId ? { promptId } : {}),
		path: descriptor.path,
	};
}

function isTeamTopology(value: string): value is TeamTopology {
	return value === "council" || value === "pair";
}

function isTeamProtocol(value: string): value is TeamProtocol {
	return value === "debate" || value === "consult" || value === "pair-coding";
}

function toTeamSpec(
	descriptor: RawMarkdownDescriptor,
	warnings: string[],
): TeamSpec | undefined {
	const frontMatter = descriptor.frontMatter;
	const id = optionalString(frontMatter.id) ?? descriptorIdFromPath(descriptor.path);
	const schemaVersion = optionalNumber(frontMatter.schemaVersion);
	const topologyValue = optionalString(frontMatter.topology);
	const protocolValue = optionalString(frontMatter.protocol);
	const agents = stringArray(frontMatter.agents) ?? [];
	if (schemaVersion !== 1) {
		warnings.push(`${id}: unsupported schemaVersion ${schemaVersion ?? "(missing)"}`);
		return undefined;
	}
	if (!topologyValue || !isTeamTopology(topologyValue)) {
		warnings.push(`${id}: invalid topology ${topologyValue ?? "(missing)"}`);
		return undefined;
	}
	if (!protocolValue || !isTeamProtocol(protocolValue)) {
		warnings.push(`${id}: invalid protocol ${protocolValue ?? "(missing)"}`);
		return undefined;
	}

	const name = optionalString(frontMatter.name) ?? id;
	const description = optionalString(frontMatter.description);
	const chair = optionalString(frontMatter.chair);
	const timeoutMs = optionalNumber(frontMatter.timeoutMs);
	const maxFixPasses = optionalNumber(frontMatter.maxFixPasses);
	return {
		schemaVersion: 1,
		id,
		name,
		...(description ? { description } : {}),
		topology: topologyValue,
		protocol: protocolValue,
		agents,
		...(chair ? { chair } : {}),
		limits: {
			...(timeoutMs ? { timeoutMs } : {}),
			...(maxFixPasses !== undefined ? { maxFixPasses } : {}),
		},
		source: "builtin",
		path: descriptor.path,
	};
}

function validateTeam(
	team: TeamSpec,
	subagents: Map<string, SubagentSpec>,
): string[] {
	const warnings: string[] = [];
	if (team.agents.length === 0) warnings.push(`${team.id}: agents must not be empty`);
	for (const agent of team.agents) {
		if (!isSubagentId(agent)) {
			warnings.push(`${team.id}: invalid agent id ${agent}`);
		}
		if (!subagents.has(agent)) warnings.push(`${team.id}: unknown agent ${agent}`);
	}
	if (team.chair && !isSubagentId(team.chair)) {
		warnings.push(`${team.id}: invalid chair id ${team.chair}`);
	}
	if (team.chair && !subagents.has(team.chair)) {
		warnings.push(`${team.id}: unknown chair ${team.chair}`);
	}
	if (team.topology === "council" && team.protocol !== "debate") {
		warnings.push(`${team.id}: council topology requires debate protocol`);
	}
	if (team.topology === "pair" && team.protocol === "debate") {
		warnings.push(`${team.id}: pair topology cannot use debate protocol`);
	}
	return warnings;
}

export function loadTeamRegistry(
	configPath: string = DEFAULT_CONFIG_JSON,
): TeamRegistry {
	const dirs = readTeamDirectories(configPath);
	const warnings: string[] = [];
	const subagents = new Map<string, SubagentSpec>();
	for (const descriptor of readMarkdownDescriptors(dirs.subagents)) {
		const spec = toSubagentSpec(descriptor);
		if (!isSubagentId(spec.id)) warnings.push(`invalid subagent id ${spec.id}`);
		if (subagents.has(spec.id)) warnings.push(`duplicate subagent id ${spec.id}`);
		subagents.set(spec.id, spec);
	}
	const teams = new Map<string, TeamSpec>();
	for (const descriptor of readMarkdownDescriptors(dirs.teams)) {
		const team = toTeamSpec(descriptor, warnings);
		if (!team) continue;
		if (teams.has(team.id)) warnings.push(`duplicate team id ${team.id}`);
		teams.set(team.id, team);
	}
	for (const team of teams.values()) warnings.push(...validateTeam(team, subagents));
	return { teams, subagents, warnings };
}

export function requireBuiltinTeam(
	id: string,
	expected: { topology: TeamTopology; protocol: TeamProtocol },
): TeamSpec {
	const registry = loadTeamRegistry();
	const team = registry.teams.get(id);
	if (!team) {
		throw new Error(
			`Required built-in team "${id}" is missing. Known: ${[...registry.teams.keys()].join(", ") || "(none)"}`,
		);
	}
	if (team.topology !== expected.topology || team.protocol !== expected.protocol) {
		throw new Error(
			`Team "${id}" must be ${expected.topology}/${expected.protocol}; got ${team.topology}/${team.protocol}.`,
		);
	}
	const teamWarnings = registry.warnings.filter((warning) => warning.startsWith(`${id}:`));
	if (teamWarnings.length > 0) {
		throw new Error(`Team "${id}" is invalid:\n${teamWarnings.join("\n")}`);
	}
	return team;
}

export function teamToCouncilDefinition(args: {
	team: TeamSpec;
	settings?: ResolvedCouncilSettings;
	snapshot?: string[];
}): CouncilDefinition {
	if (args.team.topology !== "council" || args.team.protocol !== "debate") {
		throw new Error(`Team ${args.team.id} is not a council debate team.`);
	}
	const snapshot = args.snapshot ?? [];
	const settings = args.settings ?? resolveCouncilSettings();
	const members = chooseCouncilModels(snapshot);
	return {
		name: settings.defaultCouncil.name,
		purpose: settings.defaultCouncil.purpose,
		members,
		chairman: chooseChairmanModel(snapshot, members),
		createdAt: Date.now(),
	};
}

export function teamToPairDefinition(args: {
	team: TeamSpec;
	settings?: ResolvedCouncilSettings;
}): PairDefinition {
	if (args.team.topology !== "pair") {
		throw new Error(`Team ${args.team.id} is not a pair team.`);
	}
	const settings = args.settings ?? resolveCouncilSettings();
	if (!settings.defaultPair) {
		throw new Error("No default pair configured.");
	}
	return {
		name: settings.defaultPair.name,
		navigator: settings.defaultPair.navigator,
		...(settings.defaultPair.purpose ? { purpose: settings.defaultPair.purpose } : {}),
		createdAt: Date.now(),
	};
}

function teamOkText(text: string, details: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

function teamSummary(team: TeamSpec): Record<string, unknown> {
	return {
		id: team.id,
		name: team.name,
		description: team.description,
		topology: team.topology,
		protocol: team.protocol,
		source: team.source,
	};
}

export function registerTeamTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "team_list",
		label: "List Teams",
		description: "List built-in declarative teams available in the council extension.",
		promptSnippet: "List built-in teams available for council and pair workflows",
		parameters: Type.Object({}),
		async execute() {
			const registry = loadTeamRegistry();
			const teams = [...registry.teams.values()];
			const lines = teams.map(
				(team) =>
					`- ${team.id}: ${team.name} | ${team.topology}/${team.protocol}${team.description ? ` | ${team.description}` : ""}`,
			);
			const body = lines.length > 0
				? `Teams:\n${lines.join("\n")}`
				: "No teams found.";
			return teamOkText(body, {
				teams: teams.map(teamSummary),
				warnings: registry.warnings,
			});
		},
	});

	pi.registerTool({
		name: "team_describe",
		label: "Describe Team",
		description: "Describe one built-in declarative team and its subagent references.",
		promptSnippet: "Describe a built-in council or pair team",
		parameters: Type.Object({
			id: Type.String({ description: "Team id to describe" }),
		}),
		async execute(_id, params: { id: string }) {
			const registry = loadTeamRegistry();
			const team = registry.teams.get(params.id);
			if (!team) {
				throw new Error(
					`No team "${params.id}". Known: ${[...registry.teams.keys()].join(", ") || "(none)"}`,
				);
			}
			const agents = team.agents.map((agent) => registry.subagents.get(agent) ?? { id: agent });
			const lines = [
				`${team.name} (${team.id})`,
				`Topology: ${team.topology}`,
				`Protocol: ${team.protocol}`,
				...(team.description ? [`Description: ${team.description}`] : []),
				`Agents: ${team.agents.join(", ") || "(none)"}`,
				...(team.chair ? [`Chair: ${team.chair}`] : []),
			];
			return teamOkText(lines.join("\n"), {
				team: teamSummary(team),
				agents,
				warnings: registry.warnings,
			});
		},
	});
}
