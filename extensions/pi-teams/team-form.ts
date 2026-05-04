/**
 * Team creation helpers for TUI commands and model-callable tools.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isLiveAgentRef } from "./live-agent.js";
import { loadBuiltinTeamIds, loadTeamRegistry } from "./team-registry.js";
import { DEFAULT_TEAM_DIRECTORY, DEFAULT_USER_ROOT, dirsForTeamScope } from "./team-paths.js";
import { chooseModel, chooseTeamTarget } from "./team-picker.js";
import type { TeamAgentBinding, TeamGraph, TeamModels, TeamProtocol, TeamSpec, TeamWritableSource } from "./team-types.js";

const USER_TEAM_DIR = join(DEFAULT_USER_ROOT, "teams", DEFAULT_TEAM_DIRECTORY);

export type TeamFormScope = TeamWritableSource;
export type TeamFormProtocol = TeamProtocol;

export interface TeamFormModels extends TeamModels {}

export interface TeamFormLimits {
	maxFixPasses?: number;
	timeoutMs?: number;
	maxConcurrency?: number;
	maxRetries?: number;
}

export interface TeamFormInput {
	id: string;
	name?: string;
	description?: string;
	protocol: TeamFormProtocol;
	agents: string[];
	agentBindings?: TeamAgentBinding[];
	prompts?: Record<string, string>;
	graph?: TeamGraph;
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
	source: TeamWritableSource;
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

function quote(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function roleMatches(role: string, value: string): boolean {
	const normalized = role.toLowerCase().replaceAll("-", "_");
	return normalized === value || normalized.startsWith(`${value}_`);
}

function defaultAgentBindings(args: TeamFormInput): TeamAgentBinding[] {
	const models = args.models ?? {};
	if (args.agentBindings && args.agentBindings.length > 0) return args.agentBindings;
	if (args.protocol === "debate") {
		const memberSubagent = args.agents[0] ?? subagentIdFromTeam(args.id, "member");
		const criticSubagents = args.agents.slice(1);
		const memberModelIds = models.members && models.members.length > 0 ? models.members : [undefined];
		return [
			...memberModelIds.map((model, index) => ({
				role: "member",
				subagent: memberSubagent,
				...(model ? { model } : {}),
				label: `Member ${index + 1}`,
			})),
			{
				role: "synthesis",
				subagent: subagentIdFromTeam(args.id, "synthesis"),
				...(models.synthesis ? { model: models.synthesis } : {}),
			},
			...criticSubagents.map((subagent) => ({ role: "critic", subagent })),
		];
	}
	if (args.protocol === "pair-coding") {
		return args.agents.map((subagent) => {
			const role = subagent.includes("driver") ? "driver" : "navigator";
			const model = role === "driver" ? models.driver : models.navigator;
			return { role, subagent, ...(model ? { model } : {}) };
		});
	}
	if (args.protocol === "consult") {
		return args.agents.map((subagent) => ({ role: "navigator", subagent, ...(models.navigator ? { model: models.navigator } : {}) }));
	}
	if (args.protocol === "telephone") {
		return args.agents.map((subagent, index) => ({
			role: "relay",
			subagent,
			...(models.members?.[index] ? { model: models.members[index] } : {}),
		}));
	}
	return args.agents.map((subagent) => ({ role: "agent", subagent }));
}

function applyModelsToBindings(bindings: TeamAgentBinding[], models: TeamFormModels, allRolesAreMembers = false): TeamAgentBinding[] {
	let memberIndex = 0;
	return bindings.map((binding) => {
		if (allRolesAreMembers || roleMatches(binding.role, "member") || roleMatches(binding.role, "relay")) {
			const model = models.members?.[memberIndex];
			memberIndex++;
			return { ...binding, ...(model ? { model } : {}) };
		}
		if (roleMatches(binding.role, "synthesis")) {
			return { ...binding, ...(models.synthesis ? { model: models.synthesis } : {}) };
		}
		if (roleMatches(binding.role, "driver")) {
			return { ...binding, ...(models.driver ? { model: models.driver } : {}) };
		}
		if (roleMatches(binding.role, "navigator")) {
			return { ...binding, ...(models.navigator ? { model: models.navigator } : {}) };
		}
		return binding;
	});
}

function ensureSubagentFile(dir: string, id: string): string {
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
			'generatedBy: "pi-teams"',
			"tools: []",
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

function scalar(value: string | number | boolean): string {
	return typeof value === "string" ? quote(value) : String(value);
}

function inlineList(values: string[]): string {
	return `[${values.map(quote).join(", ")}]`;
}

function inlineParameters(parameters: Record<string, string | number | boolean>): string {
	const entries = Object.entries(parameters);
	if (entries.length === 0) return "{}";
	return `{ ${entries.map(([key, value]) => `${quote(key)}: ${scalar(value)}`).join(", ")} }`;
}

function promptLines(prompts: Record<string, string> | undefined): string[] {
	const entries = Object.entries(prompts ?? {});
	return entries.length > 0 ? ["prompts:", ...entries.map(([key, value]) => `  ${key}: ${quote(value)}`)] : [];
}

function agentBindingLines(bindings: TeamAgentBinding[]): string[] {
	return [
		"agents:",
		...bindings.flatMap((binding) => [
			`  - role: ${quote(binding.role)}`,
			`    subagent: ${quote(binding.subagent)}`,
			...(binding.model ? [`    model: ${quote(binding.model)}`] : []),
			...(binding.label ? [`    label: ${quote(binding.label)}`] : []),
			...(binding.promptId ? [`    promptId: ${quote(binding.promptId)}`] : []),
			...(binding.templateId ? [`    templateId: ${quote(binding.templateId)}`] : []),
			...(binding.systemPrompt ? [`    systemPrompt: ${quote(binding.systemPrompt)}`] : []),
			...(binding.dependencyPolicy ? [`    dependencyPolicy: ${quote(binding.dependencyPolicy)}`] : []),
			...(binding.maxRetries !== undefined ? [`    maxRetries: ${binding.maxRetries}`] : []),
			...(binding.tools ? [`    tools: ${inlineList(binding.tools)}`] : []),
			...(binding.parameters ? [`    parameters: ${inlineParameters(binding.parameters)}`] : []),
		]),
	];
}

function graphLines(graph: TeamGraph | undefined): string[] {
	if (!graph) return [];
	return [
		...(graph.edges.length > 0 ? ["edges:", ...graph.edges.flatMap((edge) => [`  - from: ${quote(edge.from)}`, `    to: ${quote(edge.to)}`])] : []),
		...(graph.outputs ? [`outputs: ${inlineList(graph.outputs)}`] : []),
		...(graph.reducer ? [`reducer: ${quote(graph.reducer)}`] : []),
	];
}

function teamFileContent(args: TeamFormInput & { id: string; name: string }): string {
	const bindings = defaultAgentBindings(args);
	return [
		"---",
		"schemaVersion: 2",
		`id: ${quote(args.id)}`,
		`name: ${quote(args.name)}`,
		...(args.description ? [`description: ${quote(args.description)}`] : []),
		`protocol: ${quote(args.protocol)}`,
		...promptLines(args.prompts),
		...agentBindingLines(bindings),
		...graphLines(args.graph),
		...(args.limits?.maxFixPasses !== undefined ? [`maxFixPasses: ${args.limits.maxFixPasses}`] : []),
		...(args.limits?.timeoutMs !== undefined ? [`timeoutMs: ${args.limits.timeoutMs}`] : []),
		...(args.limits?.maxConcurrency !== undefined ? [`maxConcurrency: ${args.limits.maxConcurrency}`] : []),
		...(args.limits?.maxRetries !== undefined ? [`maxRetries: ${args.limits.maxRetries}`] : []),
		"---",
		"",
		`${args.name} team.`,
		"",
	].join("\n");
}

function validateFormInput(input: TeamFormInput): void {
	const supported = new Set(["consult", "pair-coding", "debate", "telephone"]);
	if (!supported.has(input.protocol) && (!input.agentBindings || input.agentBindings.length === 0)) {
		throw new Error(`Unsupported team protocol ${input.protocol}.`);
	}
	if (input.agents.length === 0 && (!input.agentBindings || input.agentBindings.length === 0)) {
		throw new Error("Team must include at least one subagent or live-agent ref.");
	}
}

export function createTeamFiles(input: TeamFormInput, cwd: string): TeamFormResult {
	const id = normalizeTeamId(input.id);
	if (!id) throw new Error("Team id is required.");
	validateFormInput(input);
	const scope = input.scope ?? "user";
	const dirs = dirsForTeamScope(scope, cwd);
	mkdirSync(dirs.teams, { recursive: true });
	const teamPath = join(dirs.teams, `${id}.md`);
	const overwrote = existsSync(teamPath);
	if (overwrote && !input.overwrite) {
		throw new Error(`Team "${id}" already exists at ${teamPath}. Pass overwrite=true to replace it.`);
	}
	const bindings = defaultAgentBindings({ ...input, id });
	const knownSubagents = loadTeamRegistry(undefined, { cwd }).subagents;
	const subagentIds = [...new Set(bindings.map((binding) => binding.subagent))];
	const subagentPaths = subagentIds
		.filter((agent) => !isLiveAgentRef(agent) && !knownSubagents.has(agent))
		.map((agent) => ensureSubagentFile(dirs.agents, agent));
	writeFileSync(
		teamPath,
		teamFileContent({
			...input,
			id,
			name: input.name ?? titleFromId(id),
			agentBindings: bindings,
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
		protocol: team.protocol,
		agents: team.agents,
		agentBindings: applyModelsToBindings(team.agentBindings, input.models, team.protocol === "graph" || (team.graph?.edges.length ?? 0) > 0),
		prompts: team.prompts,
		...(team.graph ? { graph: team.graph } : {}),
		models: input.models,
		limits: team.limits,
		scope: input.scope ?? (team.source === "project" ? "project" : "user"),
		overwrite: true,
	}, cwd);
}

function isGeneratedSubagent(path: string): boolean {
	try {
		return readFileSync(path, "utf8").includes('generatedBy: "pi-teams"');
	} catch {
		return false;
	}
}

function deleteGeneratedSubagents(team: TeamSpec, cwd: string): void {
	if (team.source === "builtin") return;
	const registry = loadTeamRegistry(undefined, { cwd });
	const referenced = new Set(
		[...registry.teams.values()]
			.filter((entry) => entry.id !== team.id)
			.flatMap((entry) => entry.agents),
	);
	const agentsDir = dirsForTeamScope(team.source, cwd).agents;
	for (const subagent of team.agents) {
		if (referenced.has(subagent) || isLiveAgentRef(subagent)) continue;
		const path = join(agentsDir, `${subagent}.md`);
		if (isGeneratedSubagent(path)) unlinkSync(path);
	}
}

export function deleteTeamFiles(input: TeamDeleteInput, cwd: string): TeamDeleteResult {
	const id = normalizeTeamId(input.id);
	if (!id) throw new Error("Team id is required.");
	const registry = loadTeamRegistry(undefined, { cwd });
	const team = registry.teams.get(id);
	if (input.scope) {
		const teamPath = join(dirsForTeamScope(input.scope, cwd).teams, `${id}.md`);
		if (!existsSync(teamPath)) throw new Error(`No ${input.scope} team "${id}" at ${teamPath}.`);
		unlinkSync(teamPath);
		if (team?.source === input.scope) deleteGeneratedSubagents(team, cwd);
		return { id, teamPath, source: input.scope };
	}
	if (loadBuiltinTeamIds().has(id)) {
		throw new Error(`Team "${id}" is a built-in default id. Pass scope=user or scope=project to delete only an override.`);
	}
	if (!team) throw new Error(`No team "${id}". Known: ${[...registry.teams.keys()].join(", ") || "(none)"}`);
	if (team.source === "builtin") throw new Error(`Built-in team "${id}" cannot be deleted.`);
	unlinkSync(team.path);
	deleteGeneratedSubagents(team, cwd);
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
		"telephone — sequential relay/rewrite chain",
		"pair-coding — constrained Driver/Navigator implementation loop",
	]);
	if (!protocolChoice) return undefined;
	const protocol = protocolFromChoice(protocolChoice);

	const agents: string[] = [];
	let memberModelIds: string[] | undefined;
	let synthesisId: string | undefined;
	let driverId: string | undefined;
	let navigatorId: string | undefined;
	let maxFixPasses: number | undefined;

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
	} else if (protocol === "telephone") {
		const relayCountInput = await ctx.ui.input("Relay count", "5");
		const relayCount = Math.min(10, Math.max(2, Number(relayCountInput) || 5));
		memberModelIds = [];
		for (let index = 1; index <= relayCount; index++) {
			const relay = await chooseTeamTarget(ctx, `Relay ${index} agent or model`, subagentIdFromTeam(id, `relay_${index}`));
			if (!relay) return undefined;
			agents.push(relay.subagent);
			if (relay.model) memberModelIds.push(relay.model);
		}
	} else if (protocol === "pair-coding") {
		const navigator = await chooseTeamTarget(ctx, "Navigator agent or model", subagentIdFromTeam(id, "navigator"));
		if (!navigator) return undefined;
		const driver = await chooseTeamTarget(ctx, "Driver agent or model", subagentIdFromTeam(id, "driver"));
		if (!driver) return undefined;
		agents.push(navigator.subagent, driver.subagent);
		navigatorId = await chooseTargetModel(ctx, "Navigator model", navigator);
		driverId = await chooseTargetModel(ctx, "Driver model", driver);
		const maxFixPassesInput = await ctx.ui.input("Max fix passes", "1");
		maxFixPasses = maxFixPassesInput ? Number(maxFixPassesInput) : undefined;
	}

	const result = createTeamFiles({
		id,
		name,
		...(description?.trim() ? { description: description.trim() } : {}),
		protocol,
		agents,
		models: {
			...(memberModelIds && memberModelIds.length > 0 ? { members: memberModelIds } : {}),
			...(synthesisId ? { synthesis: synthesisId } : {}),
			...(driverId ? { driver: driverId } : {}),
			...(navigatorId ? { navigator: navigatorId } : {}),
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
