/** Declarative team descriptor loading and registry construction. */

import { basename } from "node:path";
import { readMarkdownDescriptors, type RawMarkdownDescriptor } from "./front-matter.js";
import { findAgentByName, listLiveAgents } from "../../lib/agent-api.js";
import { isLiveAgentRef, liveAgentName } from "./live-agent.js";
import { validateTeamManifest } from "./team-manifest.js";
import { DEFAULT_CONFIG_JSON, teamDirectories } from "./team-paths.js";
import type {
	SubagentSpec,
	TeamAgentBinding,
	TeamModelSlotKind,
	TeamModelSlotSpec,
	TeamModels,
	TeamPromptContract,
	TeamPromptSlotKind,
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
			const maxRetries = optionalNumber(entry.maxRetries);
			if (!role || !subagent) return undefined;
			return {
				role,
				subagent,
				...(model ? { model } : {}),
				...(label ? { label } : {}),
				...(promptId ? { promptId } : {}),
				...(templateId ? { templateId } : {}),
				...(systemPrompt ? { systemPrompt } : {}),
				...(maxRetries !== undefined ? { maxRetries } : {}),
				...generationConfig(entry),
			};
		})
		.filter((entry): entry is TeamAgentBinding => entry !== undefined);
	return bindings.length > 0 ? bindings : undefined;
}

function firstModelForRole(bindings: TeamAgentBinding[], roles: string[]): string | undefined {
	return bindings.find((binding) => roleMatches(binding.role, roles) && binding.model)?.model;
}

function modelsFromBindings(bindings: TeamAgentBinding[]): TeamModels {
	const roleMembers = bindings
		.filter((binding) => roleMatches(binding.role, ["member"]) && binding.model)
		.map((binding) => binding.model as string);
	const members = roleMembers;
	return {
		...(members.length > 0 ? { members } : {}),
		...(firstModelForRole(bindings, ["synthesis"]) ? { synthesis: firstModelForRole(bindings, ["synthesis"]) } : {}),
		...(firstModelForRole(bindings, ["driver", "driver_implementation"]) ? { driver: firstModelForRole(bindings, ["driver", "driver_implementation"]) } : {}),
		...(firstModelForRole(bindings, ["navigator", "navigator_brief", "navigator_review"]) ? { navigator: firstModelForRole(bindings, ["navigator", "navigator_brief", "navigator_review"]) } : {}),
	};
}

function promptSlotKind(value: unknown): TeamPromptSlotKind | undefined {
	const parsed = optionalString(value);
	return parsed === "system" || parsed === "template" ? parsed : undefined;
}

function promptContracts(value: unknown): TeamPromptContract[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const contracts = value
		.filter(isRecord)
		.map((entry) => {
			const id = optionalString(entry.id);
			const kind = promptSlotKind(entry.kind);
			const defaultPromptId = optionalString(entry.defaultPromptId);
			const roles = stringArray(entry.roles);
			return id && kind ? { id, kind, ...(defaultPromptId ? { defaultPromptId } : {}), ...(roles ? { roles } : {}) } : undefined;
		})
		.filter((contract): contract is TeamPromptContract => contract !== undefined);
	return contracts.length > 0 ? contracts : undefined;
}

function modelSlotKind(value: unknown): TeamModelSlotKind | undefined {
	const parsed = optionalString(value);
	return parsed === "member" || parsed === "synthesis" || parsed === "driver" || parsed === "navigator" ? parsed : undefined;
}

function modelSlotCount(value: unknown): TeamModelSlotSpec["count"] | undefined {
	if (optionalString(value) === "dynamic") return "dynamic";
	const parsed = optionalNumber(value);
	return parsed !== undefined ? parsed : undefined;
}

function modelSlots(value: unknown): TeamModelSlotSpec[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const slots = value
		.filter(isRecord)
		.map((entry) => {
			const id = optionalString(entry.id);
			const kind = modelSlotKind(entry.kind);
			const count = modelSlotCount(entry.count);
			const label = optionalString(entry.label);
			return id && kind ? { id, kind, ...(count !== undefined ? { count } : {}), ...(label ? { label } : {}) } : undefined;
		})
		.filter((slot): slot is TeamModelSlotSpec => slot !== undefined);
	return slots.length > 0 ? slots : undefined;
}

function compileTeamManifest(descriptor: RawMarkdownDescriptor, warnings: string[], source: TeamSource): TeamSpec | undefined {
	const frontMatter = descriptor.frontMatter;
	const id = optionalString(frontMatter.id) ?? descriptorIdFromPath(descriptor.path);
	const schemaVersion = optionalNumber(frontMatter.schemaVersion);
	if (schemaVersion !== 2) {
		warnings.push(`${id}: schemaVersion 2 is required`);
		return undefined;
	}
	const protocol = optionalString(frontMatter.protocol);
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
	const contracts = promptContracts(frontMatter.promptContracts);
	if (frontMatter.promptContracts !== undefined && !contracts) {
		warnings.push(`${id}: promptContracts entries must include id and kind`);
		return undefined;
	}
	const slots = modelSlots(frontMatter.modelSlots);
	if (frontMatter.modelSlots !== undefined && !slots) {
		warnings.push(`${id}: modelSlots entries must include id and kind`);
		return undefined;
	}
	const agents = unique(agentBindings.map((binding) => binding.subagent));
	const timeoutMs = optionalNumber(frontMatter.timeoutMs);
	const maxFixPasses = optionalNumber(frontMatter.maxFixPasses);
	const maxRetries = optionalNumber(frontMatter.maxRetries);
	if (frontMatter.edges !== undefined || frontMatter.outputs !== undefined || frontMatter.reducer !== undefined) {
		warnings.push(`${id}: legacy workflow fields are ignored; direct team protocols no longer execute generic workflows`);
	}
	return {
		schemaVersion: 2,
		id,
		name,
		...(description ? { description } : {}),
		protocol,
		prompts: promptRefs(frontMatter.prompts),
		...(contracts ? { promptContracts: contracts } : {}),
		...(slots ? { modelSlots: slots } : {}),
		agents,
		agentBindings,
		models: modelsFromBindings(agentBindings),
		limits: {
			...(timeoutMs ? { timeoutMs } : {}),
			...(maxFixPasses !== undefined ? { maxFixPasses } : {}),
			...(optionalNumber(frontMatter.maxConcurrency) !== undefined ? { maxConcurrency: optionalNumber(frontMatter.maxConcurrency) } : {}),
			...(maxRetries !== undefined ? { maxRetries } : {}),
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

function liveAgentWarning(teamId: string, ref: string): string | undefined {
	const name = liveAgentName(ref);
	if (!name) return `${teamId}: invalid live-agent ref ${ref}; use agent:<registered-name>`;
	const agent = findAgentByName(name);
	if (!agent) return `${teamId}: live agent ${ref} is not registered. Available: ${listLiveAgents().map((entry) => entry.name).join(", ") || "(none)"}`;
	if (!agent.alive) return `${teamId}: live agent ${ref} is terminated`;
	if (agent.status === "blocked" || agent.status === "stalled") return `${teamId}: live agent ${ref} is ${agent.status}`;
	if (agent.status !== "running" && agent.status !== "waiting") return `${teamId}: live agent ${ref} is ${agent.status}`;
	return undefined;
}

function validateTeam(team: TeamSpec, subagents: Map<string, SubagentSpec>): string[] {
	const warnings: string[] = [];
	try {
		validateTeamManifest(team);
	} catch (error) {
		warnings.push(`${team.id}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (team.agentBindings.length === 0) warnings.push(`${team.id}: agents must not be empty`);
	for (const binding of team.agentBindings) {
		if (isLiveAgentRef(binding.subagent)) {
			const warning = liveAgentWarning(team.id, binding.subagent);
			if (warning) warnings.push(warning);
			continue;
		}
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
			const team = compileTeamManifest(descriptor, warnings, dirs.source);
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
