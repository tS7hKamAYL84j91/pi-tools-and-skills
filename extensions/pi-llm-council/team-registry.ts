/**
 * Declarative team descriptor loading and registry construction.
 */

import { basename } from "node:path";
import { readMarkdownDescriptors, type RawMarkdownDescriptor } from "./front-matter.js";
import { chooseChairmanModel, chooseCouncilModels } from "./members.js";
import { resolveCouncilSettings, type ResolvedCouncilSettings } from "./settings.js";
import { DEFAULT_CONFIG_JSON, teamDirectories } from "./team-paths.js";
import type {
	SubagentSpec,
	TeamAgentBinding,
	TeamModels,
	TeamProtocol,
	TeamRegistry,
	TeamRegistryOptions,
	TeamSource,
	TeamSpec,
	TeamTopology,
} from "./team-types.js";
import type { CouncilDefinition } from "./types.js";

interface PairDefinition {
	name: string;
	navigator: string;
	purpose?: string;
	createdAt: number;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function roleMatches(role: string, candidates: string[]): boolean {
	const normalized = role.toLowerCase().replaceAll("-", "_");
	return candidates.some((candidate) => normalized === candidate || normalized.startsWith(`${candidate}_`));
}

function firstModelForRole(bindings: TeamAgentBinding[], roles: string[]): string | undefined {
	return bindings.find((binding) => roleMatches(binding.role, roles) && binding.model)?.model;
}

function modelsFromBindings(
	bindings: TeamAgentBinding[],
	topology: TeamTopology,
	protocol: TeamProtocol,
): TeamModels {
	if (topology === "council" && protocol === "debate") {
		const members = bindings
			.filter((binding) => roleMatches(binding.role, ["member"]) && binding.model)
			.map((binding) => binding.model as string);
		return {
			...(members.length > 0 ? { members } : {}),
			...(firstModelForRole(bindings, ["chairman", "chair"]) ? { chairman: firstModelForRole(bindings, ["chairman", "chair"]) } : {}),
		};
	}
	if (topology === "pair" && protocol === "pair-coding") {
		return {
			...(firstModelForRole(bindings, ["driver"]) ? { driver: firstModelForRole(bindings, ["driver"]) } : {}),
			...(firstModelForRole(bindings, ["navigator"]) ? { navigator: firstModelForRole(bindings, ["navigator"]) } : {}),
		};
	}
	if (topology === "pair" && protocol === "consult") {
		return {
			...(firstModelForRole(bindings, ["navigator"]) ? { navigator: firstModelForRole(bindings, ["navigator"]) } : {}),
		};
	}
	if (topology === "chain" && protocol === "telephone") {
		const members = bindings
			.filter((binding) => roleMatches(binding.role, ["relay", "member"]) && binding.model)
			.map((binding) => binding.model as string);
		return members.length > 0 ? { members } : {};
	}
	return {};
}

function agentBindingsFromObjects(value: unknown): TeamAgentBinding[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const bindings = value
		.filter(isRecord)
		.map((entry) => {
			const role = optionalString(entry.role);
			const subagent = optionalString(entry.subagent) ?? optionalString(entry.agent) ?? optionalString(entry.manifest);
			const model = optionalString(entry.model);
			const label = optionalString(entry.label);
			if (!role || !subagent) return undefined;
			return {
				role,
				subagent,
				...(model ? { model } : {}),
				...(label ? { label } : {}),
			};
		})
		.filter((entry): entry is TeamAgentBinding => entry !== undefined);
	return bindings.length > 0 ? bindings : undefined;
}

function legacyAgentBindings(args: {
	topology: TeamTopology;
	protocol: TeamProtocol;
	agents: string[];
	chair?: string;
	models: TeamModels;
}): TeamAgentBinding[] {
	if (args.topology === "council" && args.protocol === "debate") {
		const memberSubagent = args.agents[0] ?? "council_generation_member";
		return [
			...(args.models.members ?? []).map((model, index) => ({
				role: "member",
				subagent: memberSubagent,
				model,
				label: `Member ${index + 1}`,
			})),
			...(args.chair ? [{ role: "chairman", subagent: args.chair, ...(args.models.chairman ? { model: args.models.chairman } : {}) }] : []),
			...args.agents.slice(1).map((agent) => ({ role: "critic", subagent: agent })),
		];
	}
	if (args.topology === "pair" && args.protocol === "pair-coding") {
		return args.agents.map((agent) => {
			const role = agent.includes("driver") ? "driver" : "navigator";
			const model = role === "driver" ? args.models.driver : args.models.navigator;
			return { role, subagent: agent, ...(model ? { model } : {}) };
		});
	}
	if (args.topology === "pair" && args.protocol === "consult") {
		return args.agents.map((agent) => ({ role: "navigator", subagent: agent, ...(args.models.navigator ? { model: args.models.navigator } : {}) }));
	}
	if (args.topology === "chain" && args.protocol === "telephone") {
		return args.agents.map((agent, index) => ({
			role: "relay",
			subagent: agent,
			...(args.models.members?.[index] ? { model: args.models.members[index] } : {}),
		}));
	}
	return args.agents.map((agent) => ({ role: "agent", subagent: agent }));
}

function optionalNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string") return undefined;
	const parsed = Number(value.trim());
	return Number.isFinite(parsed) ? parsed : undefined;
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
	const legacyAgents = stringArray(frontMatter.agents) ?? [];
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
	const legacyModels: TeamModels = {
		...(memberModels ? { members: memberModels } : {}),
		...(chairmanModel ? { chairman: chairmanModel } : {}),
		...(driverModel ? { driver: driverModel } : {}),
		...(navigatorModel ? { navigator: navigatorModel } : {}),
	};
	if (Array.isArray(frontMatter.agents)) {
		const hasObjectEntry = frontMatter.agents.some(isRecord);
		const hasStringEntry = frontMatter.agents.some((entry) => typeof entry === "string");
		if (hasObjectEntry && hasStringEntry) {
			warnings.push(`${id}: agents list must not mix object and string entries`);
			return undefined;
		}
		if (hasObjectEntry && !agentBindingsFromObjects(frontMatter.agents)) {
			warnings.push(`${id}: object agent entries require role and subagent`);
			return undefined;
		}
	}
	const objectBindings = agentBindingsFromObjects(frontMatter.agents);
	const agentBindings = objectBindings ?? legacyAgentBindings({
		topology: topologyValue,
		protocol: protocolValue,
		agents: legacyAgents,
		...(chair ? { chair } : {}),
		models: legacyModels,
	});
	const agents = unique(agentBindings.map((binding) => binding.subagent));
	const derivedChair = chair ?? agentBindings.find((binding) => roleMatches(binding.role, ["chairman", "chair"]))?.subagent;
	const models = Object.keys(legacyModels).length > 0 ? legacyModels : modelsFromBindings(agentBindings, topologyValue, protocolValue);
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
		agentBindings,
		...(derivedChair ? { chair: derivedChair } : {}),
		models,
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
	if (team.agentBindings.length === 0) warnings.push(`${team.id}: agents must not be empty`);
	for (const binding of team.agentBindings) {
		if (!isSubagentId(binding.subagent)) {
			warnings.push(`${team.id}: invalid agent id ${binding.subagent}`);
		}
		if (!subagents.has(binding.subagent)) warnings.push(`${team.id}: unknown agent ${binding.subagent}`);
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
