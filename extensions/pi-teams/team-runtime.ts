/**
 * Mutating team tools and execution dispatch for declarative team specs.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { TeamStateManager } from "./state.js";
import { createTeamFiles, deleteTeamFiles, type TeamDeleteInput, type TeamFormInput, type TeamModelsInput, updateTeamModels } from "./team-form.js";
import { getTeamHandler, TEAM_STATUS_KEY, type TeamRunInput } from "./team-handlers.js";
import { loadTeamRegistry } from "./team-registry.js";
import type { TeamSpec } from "./team-types.js";

export interface TeamRunRegistration {
	stateManager: TeamStateManager;
}

const TeamFormSchema = Type.Object({
	id: Type.String({ description: "Team id to create or replace." }),
	name: Type.Optional(Type.String({ description: "Human-readable team name." })),
	description: Type.Optional(Type.String({ description: "Team description." })),
	protocol: Type.Union([Type.Literal("consult"), Type.Literal("debate")], { description: "Team protocol for generated team files." }),
	agents: Type.Array(Type.String(), { description: "Subagent ids or explicit live-agent refs (agent:<registered-name>) referenced by the team." }),
	models: Type.Optional(Type.Object({
		members: Type.Optional(Type.Array(Type.String(), { description: "debate member model IDs." })),
		synthesis: Type.Optional(Type.String({ description: "debate synthesis model." })),
		navigator: Type.Optional(Type.String({ description: "navigator workflow default model id." })),
	})),
	limits: Type.Optional(Type.Object({
		timeoutMs: Type.Optional(Type.Number({ description: "Per-stage timeout in milliseconds." })),
		maxRetries: Type.Optional(Type.Number({ description: "Bounded team node retries after child-call failure." })),
	})),
	scope: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")], { description: "Where to write the team. Defaults to user." })),
	overwrite: Type.Optional(Type.Boolean({ description: "Replace an existing team file." })),
});

const TeamModelsSchema = Type.Object({
	id: Type.String({ description: "Team id to update." }),
	models: Type.Object({
		members: Type.Optional(Type.Array(Type.String(), { description: "debate member model IDs." })),
		synthesis: Type.Optional(Type.String({ description: "debate synthesis model." })),
		navigator: Type.Optional(Type.String({ description: "navigator workflow model id." })),
	}),
	scope: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")], { description: "Where to write the model binding. Defaults to current team scope, or user for built-ins." })),
});

const TeamDeleteSchema = Type.Object({
	id: Type.String({ description: "Team id to delete/dissolve." }),
	scope: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")], { description: "Delete from a specific scope. Defaults to the active user/project team." })),
});

const TeamRunSchema = Type.Object({
	id: Type.String({ description: "Team id to run, e.g. llm-council, consult." }),
	prompt: Type.String({ description: "Task, question, or review request for the team." }),

	async: Type.Optional(Type.Boolean({ description: "Return immediately and deliver the team result as a follow-up message." })),
	models: Type.Optional(Type.Object({
		members: Type.Optional(Type.Array(Type.String(), { description: "debate: override member model IDs." })),
		synthesis: Type.Optional(Type.String({ description: "debate: override synthesis model ID." })),
		navigator: Type.Optional(Type.String({ description: "navigator workflow override model id." })),
	})),
	limits: Type.Optional(Type.Object({
		timeoutMs: Type.Optional(Type.Number({ description: "Per-stage timeout in milliseconds." })),
		maxRetries: Type.Optional(Type.Number({ description: "Bounded team node retries after child-call failure." })),
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
	const teamWarnings = registry.warnings.filter((warning) => warning.startsWith(`${id}:`) && !warning.includes("schemaVersion 2 is required"));
	if (teamWarnings.length > 0) {
		throw new Error(`Team "${id}" is invalid:\n${teamWarnings.join("\n")}`);
	}
	return team;
}

export async function runTeam(args: {
	params: TeamRunInput;
	ctx: ExtensionContext;
	stateManager: TeamStateManager;
}) {
	const team = requireTeam(args.params.id, args.ctx.cwd);
	const handler = getTeamHandler(team);
	if (!handler) {
		throw new Error(`Team "${team.id}" has unsupported protocol ${team.protocol}.`);
	}
	const startedAt = Date.now();
	const runId = args.stateManager.startRun({ teamId: team.id, protocol: team.protocol, prompt: args.params.prompt });
	try {
		const result = await handler.run({
			team,
			params: args.params,
			ctx: args.ctx,
			stateManager: args.stateManager,
			runId,
		});
		const text = result.content[0]?.text;
		args.stateManager.recordRunCompleted(runId, Date.now() - startedAt, text);
		return result;
	} catch (error) {
		args.stateManager.recordRunFailed(runId, error instanceof Error ? error.message : String(error));
		throw error;
	}
}

function registerTeamFormTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "team_form",
		label: "Form Team",
		description: "Create or replace a declarative team in user or project scope, creating missing subagent stubs as needed. Use agent:<name> to bind a role to a registered live peer.",
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
		description: "Update model bindings for a user or project team without changing its protocol or agents.",
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
		promptSnippet: "Run a declarative team by id",
		promptGuidelines: [
			"Use team_run with id=llm-council for high-impact architecture, strategy, or research where disagreement is valuable.",
			"Use team_run with id=consult for lightweight Navigator review.",

		],
		parameters: TeamRunSchema,
		async execute(_id, params: TeamRunInput, _signal, _onUpdate, ctx) {
			if (params.async) {
				void runTeam({ params: { ...params, async: undefined }, ctx, stateManager: registration.stateManager })
					.then((result) => {
						const text = result.content.map((entry) => entry.text).join("\n");
						pi.sendUserMessage(`[Team "${params.id}" async result]\n\n${text}`, { deliverAs: "followUp" });
					})
					.catch((error: unknown) => {
						pi.sendUserMessage(`[Team "${params.id}" async failed]\n\n${error instanceof Error ? error.message : String(error)}`, { deliverAs: "followUp" });
					})
					.finally(() => ctx.ui.setStatus(TEAM_STATUS_KEY, "teams: ready"));
				return okText(`Team "${params.id}" started asynchronously. Result will arrive as a follow-up message.`, { team: params.id, async: true });
			}
			try {
				return await runTeam({ params, ctx, stateManager: registration.stateManager });
			} finally {
				ctx.ui.setStatus(TEAM_STATUS_KEY, "teams: ready");
			}
		},
	});
}
