/**
 * Mutating team tools and execution dispatch for declarative team specs.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { CouncilStateManager } from "./state.js";
import { createTeamFiles, deleteTeamFiles, type TeamDeleteInput, type TeamFormInput, type TeamModelsInput, updateTeamModels } from "./team-form.js";
import { getTeamHandler, TEAM_STATUS_KEY, type TeamRunInput } from "./team-handlers.js";
import { loadTeamRegistry } from "./team-registry.js";
import type { TeamSpec } from "./team-types.js";

export interface TeamRunRegistration {
	stateManager: CouncilStateManager;
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

export async function runTeam(args: {
	params: TeamRunInput;
	ctx: ExtensionContext;
	stateManager: CouncilStateManager;
}) {
	const team = requireTeam(args.params.id, args.ctx.cwd);
	const handler = getTeamHandler(team);
	if (!handler) {
		throw new Error(`Team "${team.id}" has unsupported topology/protocol ${team.topology}/${team.protocol}.`);
	}
	return handler.run({
		team,
		params: args.params,
		ctx: args.ctx,
		stateManager: args.stateManager,
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
