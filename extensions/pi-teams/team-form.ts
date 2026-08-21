/**
 * Team creation helpers for TUI commands and model-callable tools.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { isLiveAgentRef } from "./live-agent.js";
import { applyModelsToBindings, defaultAgentBindings } from "./team-form-bindings.js";
import { assertGeneratedSubagentsDirectory, assertSafeGeneratedSubagentId, assertTeamDefinitionFile, assertTeamDefinitionsDirectory, deleteGeneratedSubagents, ensureGeneratedSubagentsDirectory, ensureSubagentFile, ensureTeamDefinitionsDirectory } from "./team-form-files.js";
import { loadBuiltinTeamIds, loadTeamRegistry } from "./team-registry.js";
import { dirsForTeamScope } from "./team-paths.js";
import { chooseModel, chooseTeamTarget } from "./team-picker.js";
import type { TeamFormInput, TeamFormModels, TeamFormProtocol, TeamFormScope } from "./team-form-types.js";
import { teamFileContent } from "./team-form-yaml.js";

export type { TeamFormInput, TeamFormModels, TeamFormScope };

export interface TeamDeleteInput {
	id: string;
	scope?: TeamFormScope;
}

export interface TeamModelsInput {
	id: string;
	models: TeamFormModels;
	scope?: TeamFormScope;
}

interface TeamFormResult {
	id: string;
	teamPath: string;
	subagentPaths: string[];
	scope: TeamFormScope;
	overwrote: boolean;
}

interface TeamDeleteResult {
	id: string;
	teamPath: string;
	source: TeamFormScope;
}

function normalizeTeamId(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

function subagentIdFromTeam(teamId: string, role: string): string {
	const base = teamId.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
	return `${base || "team"}_${role}`;
}

function titleFromId(id: string): string {
	return id.split(/[-_]/).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function uniqueTeamId(cwd: string, baseId: string): string {
	const base = baseId || "team";
	const existing = loadTeamRegistry(undefined, { cwd }).teams;
	if (!existing.has(base)) return base;
	for (let index = 2; index < 1000; index++) {
		const candidate = `${base}-${index}`;
		if (!existing.has(candidate)) return candidate;
	}
	throw new Error(`Could not allocate a unique team id for ${base}.`);
}

function choiceId(choice: string): string {
	return choice.split(" — ")[0]?.trim() ?? choice.trim();
}

async function chooseMemberModels(ctx: ExtensionContext): Promise<string[]> {
	const result: string[] = [];
	for (let index = 1; index <= 5; index++) {
		const model = await chooseModel(ctx, `Debate member ${index} model${index <= 3 ? "" : " (optional)"}`);
		if (!model) {
			if (index <= 3 && result.length === 0) continue;
			break;
		}
		result.push(model);
		if (index >= 3) {
			const addMore = await ctx.ui.confirm("Add another debate member?", "Debate supports up to 5 members.");
			if (!addMore) break;
		}
	}
	return result;
}

function protocolFromChoice(choice: string): TeamFormProtocol {
	return choiceId(choice) as TeamFormProtocol;
}

async function chooseTargetModel(ctx: ExtensionContext, label: string, target: { subagent: string; model?: string }): Promise<string | undefined> {
	if (target.model) return target.model;
	if (isLiveAgentRef(target.subagent)) return undefined;
	return chooseModel(ctx, label);
}

function validateFormInput(input: TeamFormInput): void {
	const supported = new Set(["consult", "debate", "research", "hierarchical-swarm"]);
	if (!supported.has(input.protocol) && (!input.agentBindings || input.agentBindings.length === 0)) {
		throw new Error(`Unsupported team protocol ${input.protocol}.`);
	}
	if (input.agents.length === 0 && (!input.agentBindings || input.agentBindings.length === 0)) {
		throw new Error("Team must include at least one subagent or live-agent ref.");
	}
}

export async function createTeamFiles(input: TeamFormInput, cwd: string): Promise<TeamFormResult> {
	const id = normalizeTeamId(input.id);
	if (!id) throw new Error("Team id is required.");
	validateFormInput(input);
	const scope = input.scope ?? "user";
	const dirs = dirsForTeamScope(scope, cwd);
	const bindings = defaultAgentBindings({ ...input, id });
	const generatedBindings = bindings.filter((binding) => !isLiveAgentRef(binding.subagent));
	for (const binding of generatedBindings) assertSafeGeneratedSubagentId(binding.subagent);
	ensureTeamDefinitionsDirectory(dirs.teams);
	const teamPath = join(dirs.teams, `${id}.md`);
	assertTeamDefinitionFile(teamPath);
	if (generatedBindings.length > 0) ensureGeneratedSubagentsDirectory(dirs.agents);
	const overwrote = existsSync(teamPath);
	if (overwrote && !input.overwrite) {
		throw new Error(`Team "${id}" already exists at ${teamPath}. Pass overwrite=true to replace it.`);
	}
	const knownSubagents = loadTeamRegistry(undefined, { cwd }).subagents;
	const subagentIds = [...new Set(bindings.map((binding) => binding.subagent))];
	const subagentPaths = await Promise.all(subagentIds
		.filter((agent) => !isLiveAgentRef(agent) && !knownSubagents.has(agent))
		.map((agent) => ensureSubagentFile(dirs.agents, agent)));
	await writeFileAtomic(
		teamPath,
		teamFileContent({
			...input,
			id,
			name: input.name ?? titleFromId(id),
			agentBindings: bindings,
		}),
		{ encoding: "utf8" }
	);
	return { id, teamPath, subagentPaths, scope, overwrote };
}

export async function updateTeamModels(input: TeamModelsInput, cwd: string): Promise<TeamFormResult> {
	const id = normalizeTeamId(input.id);
	if (!id) throw new Error("Team id is required.");
	const registry = loadTeamRegistry(undefined, { cwd });
	const team = registry.teams.get(id);
	if (!team) throw new Error(`No team "${id}". Known: ${[...registry.teams.keys()].join(", ") || "(none)"}`);
	if (team.source !== "builtin") assertTeamDefinitionFile(team.path);
	return createTeamFiles({
		id,
		name: team.name,
		...(team.description ? { description: team.description } : {}),
		protocol: team.protocol,
		agents: team.agents,
		agentBindings: applyModelsToBindings(team.agentBindings, input.models),
		prompts: team.prompts,
		models: input.models,
		limits: team.limits,
		scope: input.scope ?? (team.source === "project" ? "project" : "user"),
		overwrite: true,
	}, cwd);
}

export async function deleteTeamFiles(input: TeamDeleteInput, cwd: string): Promise<TeamDeleteResult> {
	const id = normalizeTeamId(input.id);
	if (!id) throw new Error("Team id is required.");
	if (input.scope) {
		const dirs = dirsForTeamScope(input.scope, cwd);
		assertGeneratedSubagentsDirectory(dirs.agents);
		assertTeamDefinitionsDirectory(dirs.teams);
		const teamPath = join(dirs.teams, `${id}.md`);
		assertTeamDefinitionFile(teamPath);
		if (!existsSync(teamPath)) throw new Error(`No ${input.scope} team "${id}" at ${teamPath}.`);
		const team = loadTeamRegistry(undefined, { cwd }).teams.get(id);
		if (team?.source === input.scope) await deleteGeneratedSubagents(team, cwd);
		await rm(teamPath).catch(() => {});
		return { id, teamPath, source: input.scope };
	}
	const registry = loadTeamRegistry(undefined, { cwd });
	const team = registry.teams.get(id);
	if (loadBuiltinTeamIds().has(id)) {
		throw new Error(`Team "${id}" is a built-in default id. Pass scope=user or scope=project to delete only an override.`);
	}
	if (!team) throw new Error(`No team "${id}". Known: ${[...registry.teams.keys()].join(", ") || "(none)"}`);
	if (team.source === "builtin") throw new Error(`Built-in team "${id}" cannot be deleted.`);
	assertTeamDefinitionFile(team.path);
	await deleteGeneratedSubagents(team, cwd);
	await rm(team.path).catch(() => {});
	return { id, teamPath: team.path, source: team.source };
}

export async function formTeam(
	ctx: ExtensionContext,
	requestedId?: string,
): Promise<string | undefined> {
	const nameInput = await ctx.ui.input("Team name", requestedId ? titleFromId(normalizeTeamId(requestedId)) : "My Review");
	const name = nameInput?.trim() || "My Review";
	const id = requestedId ? normalizeTeamId(requestedId) : uniqueTeamId(ctx.cwd, normalizeTeamId(name));
	if (!id) return undefined;
	const description = await ctx.ui.input("Description (optional)", "");
	const protocolChoice = await ctx.ui.select("Protocol", [
		"consult — one Navigator gives focused review",
		"debate — members critique and synthesis joins answers",
	]);
	if (!protocolChoice) return undefined;
	const protocol = protocolFromChoice(protocolChoice);

	const agents: string[] = [];
	let memberModelIds: string[] | undefined;
	let synthesisId: string | undefined;
	let navigatorId: string | undefined;

	if (protocol === "consult") {
		const navigator = await chooseTeamTarget(ctx, "Navigator agent or model", subagentIdFromTeam(id, "navigator"));
		if (!navigator) return undefined;
		agents.push(navigator.subagent);
		navigatorId = await chooseTargetModel(ctx, "Navigator model", navigator);
	} else if (protocol === "debate") {
		const member = await chooseTeamTarget(ctx, "Member agent or model", subagentIdFromTeam(id, "member"));
		if (!member) return undefined;
		agents.push(member.subagent);
		const critic = await chooseTeamTarget(ctx, "Critic agent or model", subagentIdFromTeam(id, "critic"));
		if (critic) agents.push(critic.subagent);
		memberModelIds = member.model ? [member.model] : isLiveAgentRef(member.subagent) ? undefined : await chooseMemberModels(ctx);
		synthesisId = await chooseModel(ctx, "Synthesis model");
	}

	const teamPath = join(dirsForTeamScope("user", ctx.cwd).teams, `${id}.md`);
	const result = await createTeamFiles({
		id,
		name,
		...(description?.trim() ? { description: description.trim() } : {}),
		protocol,
		agents,
		models: {
			...(memberModelIds && memberModelIds.length > 0 ? { members: memberModelIds } : {}),
			...(synthesisId ? { synthesis: synthesisId } : {}),
			...(navigatorId ? { navigator: navigatorId } : {}),
		},
		overwrite: existsSync(teamPath)
			? await ctx.ui.confirm("Overwrite team?", `${teamPath} already exists. Replace it?`)
			: false,
	}, ctx.cwd);
	ctx.ui.notify(`Team "${id}" written to ${result.teamPath}`, "info");
	return id;
}
