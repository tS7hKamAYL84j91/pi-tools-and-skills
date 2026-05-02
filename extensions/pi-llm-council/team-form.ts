/**
 * Team creation helpers for TUI commands and model-callable tools.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loadBuiltinTeamIds, loadTeamRegistry, type TeamSource } from "./teams.js";

const USER_TEAM_DIR = join(homedir(), ".pi", "agent", "teams");
const USER_SUBAGENT_DIR = join(homedir(), ".pi", "agent", "subagents");

export type TeamFormScope = "user" | "project";
export type TeamFormTopology = "chain" | "pair" | "council";
export type TeamFormProtocol = "consult" | "pair-coding" | "debate" | "telephone";

export interface TeamFormModels {
	members?: string[];
	chairman?: string;
	driver?: string;
	navigator?: string;
}

export interface TeamFormLimits {
	maxFixPasses?: number;
	timeoutMs?: number;
}

export interface TeamFormInput {
	id: string;
	name?: string;
	description?: string;
	topology: TeamFormTopology;
	protocol: TeamFormProtocol;
	agents: string[];
	models?: TeamFormModels;
	limits?: TeamFormLimits;
	scope?: TeamFormScope;
	overwrite?: boolean;
}

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
	source: Exclude<TeamSource, "builtin">;
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

function parseList(value: string | undefined): string[] {
	return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function quote(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
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

function dirsForScope(scope: TeamFormScope, cwd: string): { teams: string; subagents: string } {
	if (scope === "project") {
		const root = findProjectRoot(cwd);
		return {
			teams: join(root, ".pi", "teams"),
			subagents: join(root, ".pi", "subagents"),
		};
	}
	return { teams: USER_TEAM_DIR, subagents: USER_SUBAGENT_DIR };
}

function ensureSubagentFile(dir: string, id: string, model?: string): string {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${id}.md`);
	if (existsSync(path)) return path;
	writeFileSync(
		path,
		[
			"---",
			`name: ${quote(id)}`,
			'version: "1.0.0"',
			`description: ${quote(`${titleFromId(id)} team role.`)}`,
			...(model ? [`model: ${quote(model)}`] : []),
			"tools: []",
			"parameters:",
			"  temperature: 0.1",
			"---",
			"",
			"# IDENTITY",
			"",
			`You are ${titleFromId(id)}.`,
			"",
			"# CONSTRAINTS",
			"",
			"- Stay within the requested scope.",
			"- Be concise, technical, and explicit about uncertainty.",
			"",
			"# HANDBACK PROTOCOL",
			"",
			"Return SUMMARY, OUTPUT, and STATUS.",
		].join("\n"),
		"utf8",
	);
	return path;
}

function teamFileContent(args: TeamFormInput & { id: string; name: string }): string {
	return [
		"---",
		"schemaVersion: 1",
		`id: ${quote(args.id)}`,
		`name: ${quote(args.name)}`,
		...(args.description ? [`description: ${quote(args.description)}`] : []),
		`topology: ${quote(args.topology)}`,
		`protocol: ${quote(args.protocol)}`,
		"agents:",
		...args.agents.map((agent) => `  - ${quote(agent)}`),
		...(args.models?.members?.length ? ["memberModels:", ...args.models.members.map((model) => `  - ${quote(model)}`)] : []),
		...(args.models?.chairman ? [`chairmanModel: ${quote(args.models.chairman)}`] : []),
		...(args.models?.driver ? [`driverModel: ${quote(args.models.driver)}`] : []),
		...(args.models?.navigator ? [`navigatorModel: ${quote(args.models.navigator)}`] : []),
		...(args.limits?.maxFixPasses !== undefined ? [`maxFixPasses: ${args.limits.maxFixPasses}`] : []),
		...(args.limits?.timeoutMs !== undefined ? [`timeoutMs: ${args.limits.timeoutMs}`] : []),
		"---",
		"",
		`${args.name} team.`,
		"",
	].join("\n");
}

function validateFormInput(input: TeamFormInput): void {
	if (input.topology === "council" && input.protocol !== "debate") {
		throw new Error("Council teams must use protocol=debate.");
	}
	if (input.topology === "pair" && input.protocol !== "consult" && input.protocol !== "pair-coding") {
		throw new Error("Pair teams must use protocol=consult or protocol=pair-coding.");
	}
	if (input.topology === "chain" && input.protocol !== "telephone") {
		throw new Error("Chain teams must use protocol=telephone.");
	}
	if (input.agents.length === 0) throw new Error("Team must include at least one subagent.");
}

export function createTeamFiles(input: TeamFormInput, cwd: string): TeamFormResult {
	const id = normalizeTeamId(input.id);
	if (!id) throw new Error("Team id is required.");
	validateFormInput(input);
	const scope = input.scope ?? "user";
	const dirs = dirsForScope(scope, cwd);
	mkdirSync(dirs.teams, { recursive: true });
	const teamPath = join(dirs.teams, `${id}.md`);
	const overwrote = existsSync(teamPath);
	if (overwrote && !input.overwrite) {
		throw new Error(`Team "${id}" already exists at ${teamPath}. Pass overwrite=true to replace it.`);
	}
	const model = input.models?.navigator ?? input.models?.driver ?? input.models?.chairman ?? input.models?.members?.[0];
	const subagentPaths = input.agents.map((agent) => ensureSubagentFile(dirs.subagents, agent, model));
	writeFileSync(
		teamPath,
		teamFileContent({
			...input,
			id,
			name: input.name ?? titleFromId(id),
		}),
		"utf8",
	);
	return { id, teamPath, subagentPaths, scope, overwrote };
}

export function updateTeamModels(input: TeamModelsInput, cwd: string): TeamFormResult {
	const id = normalizeTeamId(input.id);
	if (!id) throw new Error("Team id is required.");
	const registry = loadTeamRegistry(undefined, { cwd });
	const team = registry.teams.get(id);
	if (!team) throw new Error(`No team "${id}". Known: ${[...registry.teams.keys()].join(", ") || "(none)"}`);
	return createTeamFiles({
		id,
		name: team.name,
		...(team.description ? { description: team.description } : {}),
		topology: team.topology,
		protocol: team.protocol,
		agents: team.agents,
		models: input.models,
		limits: team.limits,
		scope: input.scope ?? (team.source === "project" ? "project" : "user"),
		overwrite: true,
	}, cwd);
}

export function deleteTeamFiles(input: TeamDeleteInput, cwd: string): TeamDeleteResult {
	const id = normalizeTeamId(input.id);
	if (!id) throw new Error("Team id is required.");
	if (input.scope) {
		const teamPath = join(dirsForScope(input.scope, cwd).teams, `${id}.md`);
		if (!existsSync(teamPath)) throw new Error(`No ${input.scope} team "${id}" at ${teamPath}.`);
		unlinkSync(teamPath);
		return { id, teamPath, source: input.scope };
	}
	if (loadBuiltinTeamIds().has(id)) {
		throw new Error(`Team "${id}" is a built-in default id. Pass scope=user or scope=project to delete only an override.`);
	}
	const registry = loadTeamRegistry(undefined, { cwd });
	const team = registry.teams.get(id);
	if (!team) throw new Error(`No team "${id}". Known: ${[...registry.teams.keys()].join(", ") || "(none)"}`);
	if (team.source === "builtin") throw new Error(`Built-in team "${id}" cannot be deleted.`);
	unlinkSync(team.path);
	return { id, teamPath: team.path, source: team.source };
}

export async function formTeam(
	ctx: ExtensionContext,
	requestedId?: string,
): Promise<string | undefined> {
	const rawId = requestedId || await ctx.ui.input("Team id", "my-review");
	const id = normalizeTeamId(rawId ?? "");
	if (!id) return undefined;
	const name = await ctx.ui.input("Team name", titleFromId(id)) ?? titleFromId(id);
	const description = await ctx.ui.input("Description (optional)", "");
	const topologyChoice = await ctx.ui.select("Topology", ["pair", "council", "chain"]);
	if (!topologyChoice) return undefined;
	const topology = topologyChoice as TeamFormTopology;
	const protocolChoice = topology === "council"
		? "debate"
		: topology === "chain"
			? "telephone"
			: await ctx.ui.select("Protocol", ["consult", "pair-coding"]);
	if (!protocolChoice) return undefined;
	const protocol = protocolChoice as TeamFormProtocol;

	const defaultAgents = protocol === "debate"
		? [subagentIdFromTeam(id, "member"), subagentIdFromTeam(id, "critic")]
		: protocol === "telephone"
			? [1, 2, 3, 4, 5].map((index) => subagentIdFromTeam(id, `relay_${index}`))
			: protocol === "pair-coding"
				? [subagentIdFromTeam(id, "navigator_brief"), subagentIdFromTeam(id, "driver"), subagentIdFromTeam(id, "navigator_review")]
				: [subagentIdFromTeam(id, "navigator")];
	const agentInput = await ctx.ui.input("Subagents (comma-separated)", defaultAgents.join(", "));
	const agents = parseList(agentInput).length > 0 ? parseList(agentInput) : defaultAgents;

	const memberModels = protocol === "debate" ? parseList(await ctx.ui.input("Member models (comma-separated, optional)", "")) : undefined;
	const chairmanModel = protocol === "debate" ? await ctx.ui.input("Chairman model (optional)", "") : undefined;
	const driverModel = protocol === "pair-coding" ? await ctx.ui.input("Driver model (optional)", "") : undefined;
	const navigatorModel = protocol === "consult" || protocol === "pair-coding" ? await ctx.ui.input("Navigator model or agent:<name> (optional)", "") : undefined;
	const maxFixPassesInput = protocol === "pair-coding" ? await ctx.ui.input("Max fix passes", "1") : undefined;
	const maxFixPasses = maxFixPassesInput ? Number(maxFixPassesInput) : undefined;

	const result = createTeamFiles({
		id,
		name,
		...(description?.trim() ? { description: description.trim() } : {}),
		topology,
		protocol,
		agents,
		models: {
			...(memberModels && memberModels.length > 0 ? { members: memberModels } : {}),
			...(chairmanModel?.trim() ? { chairman: chairmanModel.trim() } : {}),
			...(driverModel?.trim() ? { driver: driverModel.trim() } : {}),
			...(navigatorModel?.trim() ? { navigator: navigatorModel.trim() } : {}),
		},
		limits: {
			...(Number.isFinite(maxFixPasses) ? { maxFixPasses } : {}),
		},
		overwrite: existsSync(join(USER_TEAM_DIR, `${id}.md`))
			? await ctx.ui.confirm("Overwrite team?", `${join(USER_TEAM_DIR, `${id}.md`)} already exists. Replace it?`)
			: false,
	}, ctx.cwd);
	ctx.ui.notify(`Team "${id}" written to ${result.teamPath}`, "info");
	return id;
}
