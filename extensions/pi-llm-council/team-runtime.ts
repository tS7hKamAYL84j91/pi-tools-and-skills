/**
 * Team execution tool for the council extension.
 *
 * This is the standard execution surface after the teams migration. It runs
 * validated team specs through the existing low-level debate and pair engines.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { findAgentByName } from "../../lib/agent-api.js";
import { askAgent } from "./agent-runner.js";
import { deliberate, formatFailures, preflight } from "./deliberation.js";
import { snapshotAvailableModels } from "./members.js";
import { type PairResult, runPairCoding } from "./pair-coding.js";
import { navigatorConsultSystemPrompt } from "./pair-prompts.js";
import { currentPanopticonRecord, runMember } from "./runner.js";
import { resolveCouncilSettings } from "./settings.js";
import type { CouncilStateManager } from "./state.js";
import { createTeamFiles, deleteTeamFiles, formTeam, type TeamDeleteInput, type TeamFormInput, type TeamModelsInput, updateTeamModels } from "./team-form.js";
import { selectTeamModels } from "./team-models.js";
import { openTeamBrowserOverlay, openTeamOverlay, pickTeamId, teamDescriptionLines } from "./team-overlay.js";
import { loadTeamRegistry, teamToCouncilDefinition, type TeamSpec } from "./teams.js";
import type { CouncilDefinition } from "./types.js";

const TEAM_STATUS_KEY = "team";
const CONSULT_TIMEOUT_MS = 5 * 60_000;

interface TeamRunModels {
	members?: string[];
	chairman?: string;
	driver?: string;
	navigator?: string;
}

interface TeamRunLimits {
	maxFixPasses?: number;
	timeoutMs?: number;
}

interface TeamRunInput {
	id: string;
	prompt: string;
	files?: string[];
	specPath?: string;
	models?: TeamRunModels;
	limits?: TeamRunLimits;
}

interface TeamRunRegistration {
	stateManager: CouncilStateManager;
}

interface ConsultOutcome {
	body: string;
	ok: boolean;
	durationMs: number;
}

const TeamFormSchema = Type.Object({
	id: Type.String({ description: "Team id to create or replace." }),
	name: Type.Optional(Type.String({ description: "Human-readable team name." })),
	description: Type.Optional(Type.String({ description: "Team description." })),
	topology: Type.Union([Type.Literal("chain"), Type.Literal("pair"), Type.Literal("council")], { description: "Team topology." }),
	protocol: Type.Union([Type.Literal("consult"), Type.Literal("pair-coding"), Type.Literal("debate"), Type.Literal("telephone")], { description: "Team protocol." }),
	agents: Type.Array(Type.String(), { description: "Subagent ids referenced by the team." }),
	models: Type.Optional(Type.Object({
		members: Type.Optional(Type.Array(Type.String(), { description: "council: default member model IDs." })),
		chairman: Type.Optional(Type.String({ description: "council: default synthesis model." })),
		driver: Type.Optional(Type.String({ description: "pair-coding: default Driver model." })),
		navigator: Type.Optional(Type.String({ description: "pair workflows: default Navigator model or agent ref." })),
	})),
	limits: Type.Optional(Type.Object({
		maxFixPasses: Type.Optional(Type.Number({ description: "pair-coding: fix passes." })),
		timeoutMs: Type.Optional(Type.Number({ description: "Per-stage timeout in milliseconds." })),
	})),
	scope: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")], { description: "Where to write the team. Defaults to user." })),
	overwrite: Type.Optional(Type.Boolean({ description: "Replace an existing team file." })),
});

const TeamModelsSchema = Type.Object({
	id: Type.String({ description: "Team id to update." }),
	models: Type.Object({
		members: Type.Optional(Type.Array(Type.String(), { description: "council/chain member model IDs." })),
		chairman: Type.Optional(Type.String({ description: "council synthesis model." })),
		driver: Type.Optional(Type.String({ description: "pair-coding Driver model." })),
		navigator: Type.Optional(Type.String({ description: "pair Navigator model or agent ref." })),
	}),
	scope: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")], { description: "Where to write the model binding. Defaults to current team scope, or user for built-ins." })),
});

const TeamDeleteSchema = Type.Object({
	id: Type.String({ description: "Team id to delete/dissolve." }),
	scope: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")], { description: "Delete from a specific scope. Defaults to the active user/project team." })),
});

const TeamRunSchema = Type.Object({
	id: Type.String({ description: "Team id to run, e.g. default-council, pair-consult, pair-coding, telephone-game." }),
	prompt: Type.String({ description: "Task, question, or review request for the team." }),
	files: Type.Optional(Type.Array(Type.String(), { description: "pair-coding: files to load." })),
	specPath: Type.Optional(Type.String({ description: "pair-coding: spec path; defaults to spec.md or docs/spec.md." })),
	models: Type.Optional(Type.Object({
		members: Type.Optional(Type.Array(Type.String(), { description: "council: override member model IDs." })),
		chairman: Type.Optional(Type.String({ description: "council: override synthesis model ID." })),
		driver: Type.Optional(Type.String({ description: "pair-coding: override Driver model." })),
		navigator: Type.Optional(Type.String({ description: "pair workflows: override Navigator model or agent ref." })),
	})),
	limits: Type.Optional(Type.Object({
		maxFixPasses: Type.Optional(Type.Number({ description: "pair-coding: fix passes." })),
		timeoutMs: Type.Optional(Type.Number({ description: "Per-stage timeout in milliseconds." })),
	})),
});

function okText(text: string, details: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

function requireTeam(id: string, cwd: string): TeamSpec {
	const registry = loadTeamRegistry(undefined, { cwd });
	const team = registry.teams.get(id);
	if (!team) {
		throw new Error(
			`No team "${id}". Known: ${[...registry.teams.keys()].join(", ") || "(none)"}`,
		);
	}
	const teamWarnings = registry.warnings.filter((warning) => warning.startsWith(`${id}:`));
	if (teamWarnings.length > 0) {
		throw new Error(`Team "${id}" is invalid:\n${teamWarnings.join("\n")}`);
	}
	return team;
}

function rejectAgentRef(role: "driver" | "navigator", value: string): string | undefined {
	if (value.toLowerCase().startsWith("agent:")) {
		return `pair-coding ${role} must be a model id, not an agent ref ("${value}").`;
	}
	return undefined;
}

function formatPairResult(result: PairResult): ReturnType<typeof okText> {
	const sections: string[] = [];
	if (result.context.warnings.length > 0) {
		sections.push(
			`Context warnings:\n${result.context.warnings.map((warning) => `- ${warning}`).join("\n")}`,
		);
	}
	if (result.errors.length > 0) {
		sections.push(`Errors:\n${result.errors.map((error) => `- ${error}`).join("\n")}`);
	}
	const body = sections.length > 0
		? `${result.summary}\n\n${sections.join("\n\n")}`
		: result.summary;
	return okText(body, {
		team: "pair-coding",
		mode: result.mode,
		ok: result.ok,
		phases: result.phases,
		context: result.context,
		warnings: result.context.warnings,
	});
}

async function runDebateTeam(args: {
	team: TeamSpec;
	params: TeamRunInput;
	ctx: ExtensionContext;
	stateManager: CouncilStateManager;
}) {
	if (args.team.topology !== "council" || args.team.protocol !== "debate") {
		throw new Error(`Team "${args.team.id}" is not a debate team.`);
	}
	const snapshot = snapshotAvailableModels(args.ctx);
	const base = teamToCouncilDefinition({ team: args.team, snapshot });
	const definition: CouncilDefinition = {
		...base,
		members: args.params.models?.members ?? base.members,
		chairman: args.params.models?.chairman ?? base.chairman,
	};
	const report = preflight(definition, snapshot);
	args.ctx.ui.notify(`Team "${args.team.id}" debating with ${definition.members.length} member(s)...`, "info");
	const record = await deliberate({
		definition,
		prompt: args.params.prompt,
		ctx: args.ctx,
		availableSnapshot: snapshot,
		stateManager: args.stateManager,
		parallelTimeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs,
		onProgress: (text) => {
			args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: ${text}`);
		},
	});
	const failures = [...record.generation, ...record.critiques].filter((run) => !run.ok);
	const sections: string[] = [];
	if (report.warnings.length > 0) {
		sections.push(`Pre-flight warnings:\n${report.warnings.map((warning) => `- ${warning}`).join("\n")}`);
	}
	if (failures.length > 0) sections.push(`Partial failures:\n${formatFailures(failures)}`);
	const synthesis = record.synthesis?.output ?? "(no synthesis)";
	const body = sections.length > 0 ? `${synthesis}\n\n${sections.join("\n\n")}` : synthesis;
	return okText(body, {
		team: args.team.id,
		id: record.id,
		members: record.members.map((member) => member.model),
		chairman: record.chairman.model,
		warnings: report.warnings,
	});
}

async function runPairCodingTeam(args: {
	team: TeamSpec;
	params: TeamRunInput;
	ctx: ExtensionContext;
}) {
	if (args.team.topology !== "pair" || args.team.protocol !== "pair-coding") {
		throw new Error(`Team "${args.team.id}" is not a pair-coding team.`);
	}
	const settings = resolveCouncilSettings();
	const driver = args.params.models?.driver ?? args.team.models.driver ?? settings.defaultMembers[0];
	const navigator = args.params.models?.navigator ?? args.team.models.navigator ?? settings.defaultChairman;
	if (!driver || !navigator) throw new Error("pair-coding needs driver and navigator models.");
	const driverError = rejectAgentRef("driver", driver);
	if (driverError) throw new Error(driverError);
	const navigatorError = rejectAgentRef("navigator", navigator);
	if (navigatorError) throw new Error(navigatorError);
	args.ctx.ui.notify(`Team "${args.team.id}": driver=${driver} navigator=${navigator}`, "info");
	const result = await runPairCoding({
		ctx: args.ctx,
		prompt: args.params.prompt,
		driver,
		navigator,
		files: args.params.files,
		specPath: args.params.specPath,
		maxFixPasses: args.params.limits?.maxFixPasses ?? args.team.limits.maxFixPasses,
		timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs,
		onProgress: (label) => {
			args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: ${label}`);
		},
	});
	return formatPairResult(result);
}

async function consultModel(args: {
	navigator: string;
	message: string;
	ctx: ExtensionContext;
}): Promise<ConsultOutcome> {
	const promptsConfig = resolveCouncilSettings().prompts;
	const run = await runMember(
		{ label: "Navigator", model: args.navigator },
		{
			prompt: args.message,
			systemPrompt: navigatorConsultSystemPrompt(promptsConfig),
			cwd: args.ctx.cwd,
			signal: args.ctx.signal,
			parentId: (await currentPanopticonRecord(args.ctx.cwd))?.id,
		},
	);
	return {
		body: run.ok ? run.output : `Navigator failed: ${run.error ?? "unknown error"}`,
		ok: run.ok,
		durationMs: run.durationMs,
	};
}

async function consultAgent(args: {
	navigator: string;
	message: string;
	ctx: ExtensionContext;
	teamId: string;
}): Promise<ConsultOutcome> {
	const startedAt = Date.now();
	const promptsConfig = resolveCouncilSettings().prompts;
	const agentName = args.navigator.slice("agent:".length);
	const info = findAgentByName(agentName);
	if (!info) return { body: `Agent "${agentName}" is no longer registered.`, ok: false, durationMs: Date.now() - startedAt };
	if (!info.alive) {
		return {
			body: `Agent "${agentName}" is not alive (status=${info.status}).`,
			ok: false,
			durationMs: Date.now() - startedAt,
		};
	}
	const ourRecord = await currentPanopticonRecord(args.ctx.cwd);
	if (!ourRecord) {
		return {
			body: "Pilot is not registered with panopticon — cannot reach live agents.",
			ok: false,
			durationMs: Date.now() - startedAt,
		};
	}
	const consultId = `team-${args.teamId}-${Date.now().toString(36)}`;
	const reply = await askAgent({
		agentName: info.name,
		agentId: info.id,
		memberLabel: "Navigator",
		prompt: args.message,
		systemPrompt: navigatorConsultSystemPrompt(promptsConfig),
		deliberationId: consultId,
		stage: "consult",
		ourAgentId: ourRecord.id,
		ourAgentName: ourRecord.name,
		signal: args.ctx.signal,
		timeoutMs: CONSULT_TIMEOUT_MS,
	});
	return {
		body: reply.ok ? reply.output : `Navigator failed: ${reply.error ?? "unknown error"}`,
		ok: reply.ok,
		durationMs: reply.durationMs,
	};
}

function telephoneSystemPrompt(index: number, total: number): string {
	return [
		`You are relay ${index} of ${total} in a telephone-game chain.`,
		"You receive the current message from the previous relay and pass one message to the next relay.",
		"Preserve the core meaning, but rewrite naturally in your own words.",
		"Do not add explanations, markdown, labels, or commentary.",
		"Return only the message to pass along.",
	].join("\n");
}

async function runTelephoneTeam(args: {
	team: TeamSpec;
	params: TeamRunInput;
	ctx: ExtensionContext;
}) {
	if (args.team.topology !== "chain" || args.team.protocol !== "telephone") {
		throw new Error(`Team "${args.team.id}" is not a telephone chain team.`);
	}
	const settings = resolveCouncilSettings();
	const models = args.params.models?.members ?? args.team.models.members ?? settings.defaultMembers;
	const fallbackModel = models[0];
	if (!fallbackModel) throw new Error("telephone teams need at least one member model.");
	let message = args.params.prompt;
	const hops: Array<{ agent: string; model: string; ok: boolean; output: string; durationMs: number }> = [];
	for (const [index, agent] of args.team.agents.entries()) {
		const model = models[index] ?? fallbackModel;
		args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: relay ${index + 1}/${args.team.agents.length}`);
		const run = await runMember(
			{ label: agent, model },
			{
				prompt: `Current message:\n\n${message}`,
				systemPrompt: telephoneSystemPrompt(index + 1, args.team.agents.length),
				cwd: args.ctx.cwd,
				signal: args.ctx.signal,
				parentId: (await currentPanopticonRecord(args.ctx.cwd))?.id,
			},
		);
		const output = run.ok ? run.output.trim() : message;
		hops.push({ agent, model, ok: run.ok, output, durationMs: run.durationMs });
		message = output;
	}
	return okText(message, {
		team: args.team.id,
		ok: hops.every((hop) => hop.ok),
		hops,
	});
}

async function runPairConsultTeam(args: {
	team: TeamSpec;
	params: TeamRunInput;
	ctx: ExtensionContext;
}) {
	if (args.team.topology !== "pair" || args.team.protocol !== "consult") {
		throw new Error(`Team "${args.team.id}" is not a pair-consult team.`);
	}
	const settings = resolveCouncilSettings();
	const navigator = args.params.models?.navigator ?? args.team.models.navigator ?? settings.defaultPair?.navigator;
	if (!navigator) throw new Error("pair-consult needs a navigator model or agent ref.");
	args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: consulting ${navigator}`);
	const outcome = navigator.startsWith("agent:")
		? await consultAgent({ navigator, message: args.params.prompt, ctx: args.ctx, teamId: args.team.id })
		: await consultModel({ navigator, message: args.params.prompt, ctx: args.ctx });
	return okText(outcome.body, {
		team: args.team.id,
		navigator,
		durationMs: outcome.durationMs,
		ok: outcome.ok,
	});
}

async function runTeam(args: {
	params: TeamRunInput;
	ctx: ExtensionContext;
	stateManager: CouncilStateManager;
}) {
	const team = requireTeam(args.params.id, args.ctx.cwd);
	if (team.topology === "council" && team.protocol === "debate") {
		return runDebateTeam({ team, params: args.params, ctx: args.ctx, stateManager: args.stateManager });
	}
	if (team.topology === "pair" && team.protocol === "pair-coding") {
		return runPairCodingTeam({ team, params: args.params, ctx: args.ctx });
	}
	if (team.topology === "pair" && team.protocol === "consult") {
		return runPairConsultTeam({ team, params: args.params, ctx: args.ctx });
	}
	if (team.topology === "chain" && team.protocol === "telephone") {
		return runTelephoneTeam({ team, params: args.params, ctx: args.ctx });
	}
	throw new Error(`Team "${team.id}" has unsupported topology/protocol ${team.topology}/${team.protocol}.`);
}

function parseRunArgs(rawArgs: string): { id: string; prompt: string } | undefined {
	const [id, ...rest] = rawArgs.trim().split(/\s+/);
	if (!id) return undefined;
	return { id, prompt: rest.join(" ").trim() };
}

async function deleteSelectedTeam(ctx: ExtensionContext, requested?: string): Promise<string | undefined> {
	const id = await pickTeamId(ctx, requested);
	if (!id) return undefined;
	const confirmed = await ctx.ui.confirm("Delete team?", `Delete/dissolve team "${id}"?`);
	if (!confirmed) return undefined;
	const result = deleteTeamFiles({ id }, ctx.cwd);
	ctx.ui.notify(`Deleted team "${result.id}"`, "info");
	return id;
}

export function registerTeamCommands(
	pi: ExtensionAPI,
	registration: TeamRunRegistration,
): void {
	pi.registerCommand("teams", {
		description: "Browse, describe, form, configure models, delete, or run teams. Usage: /teams [list|describe [id]|form [id]|models [id]|delete [id]|run [id] [prompt]]",
		handler: async (rawArgs, ctx) => {
			const trimmed = rawArgs.trim();
			if (!trimmed || trimmed === "list") {
				await openTeamBrowserOverlay(ctx);
				return;
			}
			const [command, ...rest] = trimmed.split(/\s+/);
			if (command === "describe" || command === "describ") {
				const picked = await pickTeamId(ctx, rest[0]);
				if (!picked) return;
				await openTeamOverlay(ctx, "Team Detail", teamDescriptionLines(ctx.cwd, picked));
				return;
			}
			if (command === "form") {
				const id = await formTeam(ctx, rest.join(" ").trim() || undefined);
				if (!id) return;
				await openTeamOverlay(ctx, "Team Created", teamDescriptionLines(ctx.cwd, id));
				return;
			}
			if (command === "models") {
				const id = await selectTeamModels(ctx, rest[0]);
				if (!id) return;
				await openTeamOverlay(ctx, "Team Models Updated", teamDescriptionLines(ctx.cwd, id));
				return;
			}
			if (command === "delete" || command === "dissolve") {
				await deleteSelectedTeam(ctx, rest[0]);
				return;
			}
			const parsed = parseRunArgs(command === "run" ? rest.join(" ") : trimmed);
			const id = parsed?.id ?? await pickTeamId(ctx);
			if (!id) return;
			const promptInput = parsed?.prompt || await ctx.ui.editor("Team prompt", "");
			const prompt = promptInput?.trim() ?? "";
			if (!prompt) return;
			await ctx.waitForIdle();
			const result = await runTeam({
				params: { id, prompt },
				ctx,
				stateManager: registration.stateManager,
			});
			const text = result.content.map((entry) => entry.text).join("\n");
			pi.sendUserMessage(`[Team "${id}" result]\n\n${text}`, {
				deliverAs: "followUp",
			});
		},
	});
}

function registerTeamFormTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "team_form",
		label: "Form Team",
		description: "Create or replace a declarative team in user or project scope, creating missing subagent stubs as needed.",
		promptSnippet: "Create a user or project declarative team",
		parameters: TeamFormSchema,
		async execute(_id, params: TeamFormInput, _signal, _onUpdate, ctx) {
			const result = createTeamFiles(params, ctx.cwd);
			return okText(`Team "${result.id}" written to ${result.teamPath}.`, {
				...result,
			});
		},
	});
}

function registerTeamModelsTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "team_models",
		label: "Set Team Models",
		description: "Update model bindings for a user or project team without changing its topology, protocol, or agents.",
		promptSnippet: "Set default model bindings for a team",
		parameters: TeamModelsSchema,
		async execute(_id, params: TeamModelsInput, _signal, _onUpdate, ctx) {
			const result = updateTeamModels(params, ctx.cwd);
			return okText(`Team "${result.id}" models updated in ${result.teamPath}.`, {
				...result,
			});
		},
	});
}

function registerTeamDeleteTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "team_delete",
		label: "Delete Team",
		description: "Delete/dissolve a user or project team by id. Built-in teams cannot be deleted.",
		promptSnippet: "Delete or dissolve a user or project declarative team",
		parameters: TeamDeleteSchema,
		async execute(_id, params: TeamDeleteInput, _signal, _onUpdate, ctx) {
			const result = deleteTeamFiles(params, ctx.cwd);
			return okText(`Team "${result.id}" deleted from ${result.teamPath}.`, {
				...result,
			});
		},
	});
}

export function registerTeamRunTool(
	pi: ExtensionAPI,
	registration: TeamRunRegistration,
): void {
	registerTeamFormTool(pi);
	registerTeamModelsTool(pi);
	registerTeamDeleteTool(pi);
	pi.registerTool({
		name: "team_run",
		label: "Run Team",
		description: "Run a declarative team by id. Use team_list first if you do not know the team id.",
		promptSnippet: "Run a declarative council or pair team by id",
		promptGuidelines: [
			"Use team_run with id=default-council for high-impact architecture, strategy, or research where disagreement is valuable.",
			"Use team_run with id=pair-consult for lightweight Navigator review.",
			"Use team_run with id=pair-coding only when an automated Driver/Navigator implementation loop is explicitly requested.",
			"Use chain/telephone teams for sequential relay experiments where each member rewrites and passes a message to the next.",
		],
		parameters: TeamRunSchema,
		async execute(_id, params: TeamRunInput, _signal, _onUpdate, ctx) {
			try {
				return await runTeam({ params, ctx, stateManager: registration.stateManager });
			} finally {
				ctx.ui.setStatus(TEAM_STATUS_KEY, "teams: ready");
			}
		},
	});
}
