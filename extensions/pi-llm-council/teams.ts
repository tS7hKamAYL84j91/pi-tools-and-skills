/**
 * Declarative team specs for the council extension.
 *
 * Team specs describe built-in council and pair workflows. Execution is handled
 * by team-runtime.ts through the standard team_run tool.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
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

export type TeamTopology = "chain" | "council" | "pair";
export type TeamProtocol = "debate" | "consult" | "pair-coding" | "telephone";
export type TeamSource = "builtin" | "user" | "project";

interface SubagentSpec {
	id: string;
	name: string;
	description?: string;
	promptId?: string;
	model?: string;
	source: TeamSource;
	path: string;
}

export interface TeamModels {
	members?: string[];
	chairman?: string;
	driver?: string;
	navigator?: string;
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
	models: TeamModels;
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
	source: TeamSource;
}

interface TeamRegistryOptions {
	cwd?: string;
	userRoot?: string;
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

function readBuiltinTeamDirectories(configPath: string): TeamDirectories {
	try {
		const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
		const config = isRecord(raw) ? raw : {};
		const configDir = dirname(configPath);
		return {
			source: "builtin",
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
			source: "builtin",
			subagents: join(dirname(configPath), DEFAULT_SUBAGENT_DIRECTORY),
			teams: join(dirname(configPath), DEFAULT_TEAM_DIRECTORY),
		};
	}
}

function findProjectRoot(start: string): string {
	let dir = start;
	let parent = dirname(dir);
	while (dir !== parent) {
		if (existsSync(join(dir, "package.json"))) return dir;
		if (existsSync(join(dir, ".git"))) return dir;
		dir = parent;
		parent = dirname(dir);
	}
	return start;
}

function copyMissingMarkdownFiles(sourceDir: string, targetDir: string): void {
	if (!existsSync(sourceDir)) return;
	mkdirSync(targetDir, { recursive: true });
	for (const descriptor of readMarkdownDescriptors(sourceDir)) {
		const target = join(targetDir, basename(descriptor.path));
		if (!existsSync(target)) copyFileSync(descriptor.path, target);
	}
}

export function ensureUserTeamDefaults(
	userRoot: string = join(homedir(), ".pi", "agent"),
	configPath: string = DEFAULT_CONFIG_JSON,
): void {
	const builtin = readBuiltinTeamDirectories(configPath);
	copyMissingMarkdownFiles(builtin.teams, join(userRoot, DEFAULT_TEAM_DIRECTORY));
	copyMissingMarkdownFiles(builtin.subagents, join(userRoot, DEFAULT_SUBAGENT_DIRECTORY));
}

function teamDirectories(
	configPath: string,
	options: TeamRegistryOptions = {},
): TeamDirectories[] {
	const dirs = [readBuiltinTeamDirectories(configPath)];
	const userRoot = options.userRoot ?? join(homedir(), ".pi", "agent");
	dirs.push({
		source: "user",
		subagents: join(userRoot, DEFAULT_SUBAGENT_DIRECTORY),
		teams: join(userRoot, DEFAULT_TEAM_DIRECTORY),
	});
	if (options.cwd) {
		const projectRoot = findProjectRoot(options.cwd);
		dirs.push({
			source: "project",
			subagents: join(projectRoot, ".pi", DEFAULT_SUBAGENT_DIRECTORY),
			teams: join(projectRoot, ".pi", DEFAULT_TEAM_DIRECTORY),
		});
	}
	return dirs;
}

function descriptorIdFromPath(path: string): string {
	return basename(path, ".md");
}

function isSubagentId(value: string): boolean {
	return /^[a-z][a-z0-9_]*$/.test(value);
}

function toSubagentSpec(
	descriptor: RawMarkdownDescriptor,
	source: TeamSource,
): SubagentSpec {
	const frontMatter = descriptor.frontMatter;
	const id = optionalString(frontMatter.name) ?? descriptorIdFromPath(descriptor.path);
	const description = optionalString(frontMatter.description);
	const promptId = optionalString(frontMatter.promptId);
	const model = optionalString(frontMatter.model);
	return {
		id,
		name: id,
		...(description ? { description } : {}),
		...(promptId ? { promptId } : {}),
		...(model ? { model } : {}),
		source,
		path: descriptor.path,
	};
}

function isTeamTopology(value: string): value is TeamTopology {
	return value === "chain" || value === "council" || value === "pair";
}

function isTeamProtocol(value: string): value is TeamProtocol {
	return value === "debate" || value === "consult" || value === "pair-coding" || value === "telephone";
}

function toTeamSpec(
	descriptor: RawMarkdownDescriptor,
	warnings: string[],
	source: TeamSource,
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
	const memberModels = stringArray(frontMatter.memberModels);
	const chairmanModel = optionalString(frontMatter.chairmanModel);
	const driverModel = optionalString(frontMatter.driverModel);
	const navigatorModel = optionalString(frontMatter.navigatorModel);
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
		models: {
			...(memberModels ? { members: memberModels } : {}),
			...(chairmanModel ? { chairman: chairmanModel } : {}),
			...(driverModel ? { driver: driverModel } : {}),
			...(navigatorModel ? { navigator: navigatorModel } : {}),
		},
		limits: {
			...(timeoutMs ? { timeoutMs } : {}),
			...(maxFixPasses !== undefined ? { maxFixPasses } : {}),
		},
		source,
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
	if (team.topology === "pair" && team.protocol !== "consult" && team.protocol !== "pair-coding") {
		warnings.push(`${team.id}: pair topology requires consult or pair-coding protocol`);
	}
	if (team.topology === "chain" && team.protocol !== "telephone") {
		warnings.push(`${team.id}: chain topology requires telephone protocol`);
	}
	return warnings;
}

export function loadTeamRegistry(
	configPath: string = DEFAULT_CONFIG_JSON,
	options: TeamRegistryOptions = {},
): TeamRegistry {
	const warnings: string[] = [];
	const subagents = new Map<string, SubagentSpec>();
	const teams = new Map<string, TeamSpec>();
	for (const dirs of teamDirectories(configPath, options)) {
		for (const descriptor of readMarkdownDescriptors(dirs.subagents)) {
			const spec = toSubagentSpec(descriptor, dirs.source);
			if (!isSubagentId(spec.id)) warnings.push(`invalid subagent id ${spec.id}`);
			subagents.set(spec.id, spec);
		}
		for (const descriptor of readMarkdownDescriptors(dirs.teams)) {
			const team = toTeamSpec(descriptor, warnings, dirs.source);
			if (!team) continue;
			teams.set(team.id, team);
		}
	}
	for (const team of teams.values()) warnings.push(...validateTeam(team, subagents));
	return { teams, subagents, warnings };
}

export function loadBuiltinTeamIds(configPath: string = DEFAULT_CONFIG_JSON): Set<string> {
	return new Set(loadTeamRegistry(configPath, { userRoot: "/nonexistent/pi-team-user-root" }).teams.keys());
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
	const members = args.team.models.members ?? chooseCouncilModels(snapshot);
	return {
		name: settings.defaultCouncil.name,
		purpose: settings.defaultCouncil.purpose,
		members,
		chairman: args.team.models.chairman ?? chooseChairmanModel(snapshot, members),
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
		models: team.models,
	};
}

export function registerTeamTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "team_list",
		label: "List Teams",
		description: "List declarative teams available from built-in, user, and project configuration.",
		promptSnippet: "List teams available for council and pair workflows",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx: ExtensionContext) {
			const registry = loadTeamRegistry(DEFAULT_CONFIG_JSON, { cwd: ctx.cwd });
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
		description: "Describe one declarative team and its subagent references.",
		promptSnippet: "Describe a council or pair team",
		parameters: Type.Object({
			id: Type.String({ description: "Team id to describe" }),
		}),
		async execute(_id, params: { id: string }, _signal, _onUpdate, ctx: ExtensionContext) {
			const registry = loadTeamRegistry(DEFAULT_CONFIG_JSON, { cwd: ctx.cwd });
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
				...(team.models.members?.length ? [`Member models: ${team.models.members.join(", ")}`] : []),
				...(team.models.chairman ? [`Chairman model: ${team.models.chairman}`] : []),
				...(team.models.driver ? [`Driver model: ${team.models.driver}`] : []),
				...(team.models.navigator ? [`Navigator model: ${team.models.navigator}`] : []),
			];
			return teamOkText(lines.join("\n"), {
				team: teamSummary(team),
				agents,
				warnings: registry.warnings,
			});
		},
	});
}
