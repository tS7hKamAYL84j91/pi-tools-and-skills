/** Declarative team descriptor loading and registry construction. */

import { basename } from "node:path";
import { readMarkdownDescriptors, type RawMarkdownDescriptor } from "./front-matter.js";
import { DEFAULT_CONFIG_JSON, teamDirectories } from "./team-paths.js";
import type {
	SubagentSpec,
	TeamAgentBinding,
	TeamGraphEdge,
	TeamModels,
	TeamRegistry,
	TeamRegistryOptions,
	TeamSource,
	TeamSpec,
} from "./team-types.js";
import type { GenerationConfig, GenerationParameterValue } from "./types.js";

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const values = value.map(optionalString).filter((item): item is string => item !== undefined);
	return values.length > 0 ? values : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function generationParameterValue(value: unknown): GenerationParameterValue | undefined {
	return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}

function generationConfig(value: Record<string, unknown>): GenerationConfig {
	const tools = stringArray(value.tools);
	const rawParameters = isRecord(value.parameters) ? value.parameters : undefined;
	const parameters: Record<string, GenerationParameterValue> = {};
	for (const [key, rawValue] of Object.entries(rawParameters ?? {})) {
		const parsed = generationParameterValue(rawValue);
		if (parsed !== undefined) parameters[key] = parsed;
	}
	return {
		...(tools ? { tools } : Array.isArray(value.tools) ? { tools: [] } : {}),
		...(value.parameters !== undefined && isRecord(value.parameters) ? { parameters } : {}),
	};
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

function roleMatches(role: string, candidates: string[]): boolean {
	const normalized = role.toLowerCase().replaceAll("-", "_");
	return candidates.some((candidate) => normalized === candidate || normalized.startsWith(`${candidate}_`));
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function promptRefs(value: unknown): Record<string, string> {
	if (!isRecord(value)) return {};
	const result: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value)) {
		const parsed = optionalString(raw);
		if (parsed) result[key] = parsed;
	}
	return result;
}

function toSubagentSpec(descriptor: RawMarkdownDescriptor, source: TeamSource): SubagentSpec {
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
		...(descriptor.body.trim().length > 0 ? { systemPrompt: descriptor.body } : {}),
		...generationConfig(frontMatter),
		source,
		path: descriptor.path,
	};
}

function hasMixedAgentEntries(value: unknown): boolean {
	if (!Array.isArray(value)) return false;
	return value.some(isRecord) && value.some((entry) => typeof entry === "string");
}

function agentBindingsFromObjects(value: unknown): TeamAgentBinding[] | undefined {
	if (!Array.isArray(value) || hasMixedAgentEntries(value)) return undefined;
	const bindings = value
		.filter(isRecord)
		.map((entry) => {
			const role = optionalString(entry.role);
			const subagent = optionalString(entry.subagent);
			const model = optionalString(entry.model);
			const label = optionalString(entry.label);
			const promptId = optionalString(entry.promptId);
			const templateId = optionalString(entry.templateId);
			const systemPrompt = optionalString(entry.systemPrompt);
			const dependencyPolicy = optionalString(entry.dependencyPolicy);
			if (!role || !subagent) return undefined;
			if (dependencyPolicy !== undefined && dependencyPolicy !== "require-ok" && dependencyPolicy !== "allow-failed") return undefined;
			return {
				role,
				subagent,
				...(model ? { model } : {}),
				...(label ? { label } : {}),
				...(promptId ? { promptId } : {}),
				...(templateId ? { templateId } : {}),
				...(systemPrompt ? { systemPrompt } : {}),
				...(dependencyPolicy ? { dependencyPolicy } : {}),
				...generationConfig(entry),
			};
		})
		.filter((entry): entry is TeamAgentBinding => entry !== undefined);
	return bindings.length > 0 ? bindings : undefined;
}

function firstModelForRole(bindings: TeamAgentBinding[], roles: string[]): string | undefined {
	return bindings.find((binding) => roleMatches(binding.role, roles) && binding.model)?.model;
}

function modelsFromBindings(bindings: TeamAgentBinding[], protocol: string): TeamModels {
	const members = bindings
		.filter((binding) => roleMatches(binding.role, ["member", "relay"]) && binding.model)
		.map((binding) => binding.model as string);
	return {
		...(members.length > 0 ? { members } : {}),
		...(firstModelForRole(bindings, ["synthesis"]) ? { synthesis: firstModelForRole(bindings, ["synthesis"]) } : {}),
		...(firstModelForRole(bindings, ["driver", "driver_implementation"]) ? { driver: firstModelForRole(bindings, ["driver", "driver_implementation"]) } : {}),
		...(firstModelForRole(bindings, ["navigator", "navigator_brief", "navigator_review"]) ? { navigator: firstModelForRole(bindings, ["navigator", "navigator_brief", "navigator_review"]) } : {}),
		...(protocol === "graph" && members.length === 0 && bindings[0]?.model ? { members: [bindings[0].model] } : {}),
	};
}

function graphEdges(value: unknown): TeamGraphEdge[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const edges = value
		.filter(isRecord)
		.map((entry) => {
			const from = optionalString(entry.from);
			const to = optionalString(entry.to);
			return from && to ? { from, to } : undefined;
		})
		.filter((edge): edge is TeamGraphEdge => edge !== undefined);
	return edges.length > 0 ? edges : undefined;
}

function protocolFromFrontMatter(frontMatter: Record<string, unknown>, id: string, warnings: string[]): string | undefined {
	const protocol = optionalString(frontMatter.protocol);
	const engine = optionalString(frontMatter.engine);
	if (protocol && engine && protocol !== engine) {
		warnings.push(`${id}: protocol and engine must match; got ${protocol} and ${engine}`);
		return undefined;
	}
	return protocol ?? engine;
}

function toTeamSpec(descriptor: RawMarkdownDescriptor, warnings: string[], source: TeamSource): TeamSpec | undefined {
	const frontMatter = descriptor.frontMatter;
	const id = optionalString(frontMatter.id) ?? descriptorIdFromPath(descriptor.path);
	const schemaVersion = optionalNumber(frontMatter.schemaVersion);
	if (schemaVersion !== 2) {
		warnings.push(`${id}: schemaVersion 2 is required`);
		return undefined;
	}
	const protocol = protocolFromFrontMatter(frontMatter, id, warnings);
	if (!protocol) {
		warnings.push(`${id}: protocol is required`);
		return undefined;
	}
	const name = optionalString(frontMatter.name) ?? id;
	const description = optionalString(frontMatter.description);
	const agentBindings = agentBindingsFromObjects(frontMatter.agents);
	if (!agentBindings) {
		warnings.push(hasMixedAgentEntries(frontMatter.agents)
			? `${id}: agents list must not mix object and string entries`
			: `${id}: agents must be object entries with role and subagent`);
		return undefined;
	}
	const memberModels = stringArray(frontMatter.memberModels);
	const synthesisModel = optionalString(frontMatter.synthesisModel);
	const driverModel = optionalString(frontMatter.driverModel);
	const navigatorModel = optionalString(frontMatter.navigatorModel);
	const legacyModels: TeamModels = {
		...(memberModels ? { members: memberModels } : {}),
		...(synthesisModel ? { synthesis: synthesisModel } : {}),
		...(driverModel ? { driver: driverModel } : {}),
		...(navigatorModel ? { navigator: navigatorModel } : {}),
	};
	const graph = graphEdges(frontMatter.edges);
	const outputs = stringArray(frontMatter.outputs);
	const reducerValue = optionalString(frontMatter.reducer);
	if (reducerValue && reducerValue !== "concat") {
		warnings.push(`${id}: unsupported graph reducer ${reducerValue}`);
		return undefined;
	}
	const reducer = reducerValue === "concat" ? reducerValue : undefined;
	const agents = unique(agentBindings.map((binding) => binding.subagent));
	const timeoutMs = optionalNumber(frontMatter.timeoutMs);
	const maxFixPasses = optionalNumber(frontMatter.maxFixPasses);
	return {
		schemaVersion: 2,
		id,
		name,
		...(description ? { description } : {}),
		protocol,
		prompts: promptRefs(frontMatter.prompts),
		agents,
		agentBindings,
		...(graph || outputs || reducer ? { graph: { edges: graph ?? [], ...(outputs ? { outputs } : {}), ...(reducer ? { reducer } : {}) } } : {}),
		models: Object.keys(legacyModels).length > 0 ? legacyModels : modelsFromBindings(agentBindings, protocol),
		limits: {
			...(timeoutMs ? { timeoutMs } : {}),
			...(maxFixPasses !== undefined ? { maxFixPasses } : {}),
			...(optionalNumber(frontMatter.maxConcurrency) !== undefined ? { maxConcurrency: optionalNumber(frontMatter.maxConcurrency) } : {}),
		},
		source,
		path: descriptor.path,
	};
}

function mergeSubagentConfig(binding: TeamAgentBinding, subagent: SubagentSpec | undefined): TeamAgentBinding {
	return {
		...binding,
		...(binding.tools !== undefined ? { tools: binding.tools } : subagent?.tools !== undefined ? { tools: subagent.tools } : {}),
		...(binding.parameters !== undefined ? { parameters: binding.parameters } : subagent?.parameters !== undefined ? { parameters: subagent.parameters } : {}),
		...(subagent?.promptId !== undefined ? { subagentPromptId: subagent.promptId } : {}),
		...(subagent?.systemPrompt !== undefined ? { subagentSystemPrompt: subagent.systemPrompt } : {}),
	};
}

function validateTeam(team: TeamSpec, subagents: Map<string, SubagentSpec>): string[] {
	const warnings: string[] = [];
	if (team.agentBindings.length === 0) warnings.push(`${team.id}: agents must not be empty`);
	for (const binding of team.agentBindings) {
		if (!isSubagentId(binding.subagent)) warnings.push(`${team.id}: invalid agent id ${binding.subagent}`);
		if (!subagents.has(binding.subagent)) warnings.push(`${team.id}: unknown agent ${binding.subagent}`);
	}
	return warnings;
}

export function loadTeamRegistry(configPath: string = DEFAULT_CONFIG_JSON, options: TeamRegistryOptions = {}): TeamRegistry {
	const warnings: string[] = [];
	const subagents = new Map<string, SubagentSpec>();
	const teams = new Map<string, TeamSpec>();
	for (const dirs of teamDirectories(configPath, options)) {
		for (const descriptor of readMarkdownDescriptors(dirs.agents)) {
			const spec = toSubagentSpec(descriptor, dirs.source);
			if (!isSubagentId(spec.id)) warnings.push(`invalid subagent id ${spec.id}`);
			subagents.set(spec.id, spec);
		}
		for (const descriptor of readMarkdownDescriptors(dirs.teams)) {
			const team = toTeamSpec(descriptor, warnings, dirs.source);
			if (team) teams.set(team.id, team);
		}
	}
	for (const team of teams.values()) {
		team.agentBindings = team.agentBindings.map((binding) => mergeSubagentConfig(binding, subagents.get(binding.subagent)));
		warnings.push(...validateTeam(team, subagents));
	}
	return { teams, subagents, warnings };
}

export function loadBuiltinTeamIds(configPath: string = DEFAULT_CONFIG_JSON): Set<string> {
	return new Set(loadTeamRegistry(configPath, { roots: [] }).teams.keys());
}

export function requireBuiltinTeam(id: string, expected: { protocol: string }): TeamSpec {
	const registry = loadTeamRegistry(undefined, { roots: [] });
	const team = registry.teams.get(id);
	if (!team) throw new Error(`Required built-in team "${id}" is missing. Known: ${[...registry.teams.keys()].join(", ") || "(none)"}`);
	if (team.protocol !== expected.protocol) throw new Error(`Team "${id}" must use protocol ${expected.protocol}; got ${team.protocol}.`);
	const teamWarnings = registry.warnings.filter((warning) => warning.startsWith(`${id}:`));
	if (teamWarnings.length > 0) throw new Error(`Team "${id}" is invalid:\n${teamWarnings.join("\n")}`);
	return team;
}
