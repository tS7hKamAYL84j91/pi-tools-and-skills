/** Mutating team tools and execution dispatch for declarative team specs. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok } from "../../lib/tool-result.js";
import type { TeamRunToolResult } from "./team-run-completion.js";
import { completeRun, coerceTeamRunResult } from "./team-run-completion.js";

import type { TeamStateManager } from "./state.js";
import { createTeamFiles, type TeamFormInput, type TeamModelsInput, updateTeamModels } from "./team-form.js";
import { getTeamHandler, TEAM_STATUS_KEY, type TeamRunInput } from "./team-handlers.js";
import { formatElapsed } from "./team-handler-shared.js";
import { startTeamRunAsync } from "./team-async.js";
import { loadTeamRegistry } from "./team-registry.js";
import type { TeamProfile } from "./team-profiles.js";
import type { TeamSpec } from "./team-types.js";
import { computeNodeStall, nodeElapsed, registerTeamControlTools, registerTeamDeleteTool } from "./team-control-tools.js";

export { computeNodeStall, summarizeTeamRuns, requestTeamRunStop } from "./team-control-tools.js";

export interface TeamRunRegistration {
	stateManager: TeamStateManager;
}

const TeamFormSchema = Type.Object({
	id: Type.String({ description: "Team id to create or replace." }),
	name: Type.Optional(Type.String({ description: "Human-readable team name." })),
	description: Type.Optional(Type.String({ description: "Team description." })),
	protocol: Type.Union([Type.Literal("consult"), Type.Literal("debate"), Type.Literal("research")], { description: "Team protocol for generated team files." }),
	agents: Type.Array(Type.String(), { description: "Subagent ids or explicit live-agent refs (agent:<registered-name>) referenced by the team." }),
	models: Type.Optional(Type.Object({
		members: Type.Optional(Type.Array(Type.String(), { description: "debate member model IDs." })),
		synthesis: Type.Optional(Type.String({ description: "debate synthesis model." })),
		driver: Type.Optional(Type.String({ description: "driver/fallback model id." })),
		navigator: Type.Optional(Type.String({ description: "navigator workflow default model id." })),
	})),
	limits: Type.Optional(Type.Object({
		timeoutMs: Type.Optional(Type.Number({ description: "Per-stage timeout in milliseconds." })),
		maxRetries: Type.Optional(Type.Number({ description: "Bounded team node retries after child-call failure." })),
		maxLoops: Type.Optional(Type.Number({ description: "Maximum research feedback loops for protocol=research. Default 2, capped at 5." })),
	})),
	scope: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")], { description: "Where to write the team. Defaults to user." })),
	overwrite: Type.Optional(Type.Boolean({ description: "Replace an existing team file." })),
});

const TeamModelsSchema = Type.Object({
	id: Type.String({ description: "Team id to update." }),
	models: Type.Object({
		members: Type.Optional(Type.Array(Type.String(), { description: "debate member model IDs." })),
		synthesis: Type.Optional(Type.String({ description: "debate synthesis model." })),
		driver: Type.Optional(Type.String({ description: "driver/fallback model id." })),
		navigator: Type.Optional(Type.String({ description: "navigator workflow model id." })),
	}),
	scope: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")], { description: "Where to write the model binding. Defaults to current team scope, or user for built-ins." })),
});

const TeamRunSchema = Type.Object({
	id: Type.String({ description: "Team id to run, e.g. llm-council, navigator, deep-research." }),
	prompt: Type.String({ description: "Task, question, or review request for the team." }),
	profile: Type.Optional(Type.Unsafe<TeamProfile>({ type: "string", enum: ["fast", "balanced", "thorough"], description: "Latency/depth profile. Defaults to balanced; explicit models/limits take precedence." })),
	async: Type.Optional(Type.Boolean({ description: "Return immediately and deliver the team result as a follow-up message." })),
	models: Type.Optional(Type.Object({
		members: Type.Optional(Type.Array(Type.String(), { description: "debate/research member model IDs." })),
		synthesis: Type.Optional(Type.String({ description: "debate/research synthesis model ID." })),
		driver: Type.Optional(Type.String({ description: "driver/fallback model ID." })),
		navigator: Type.Optional(Type.String({ description: "navigator workflow override model id." })),
	})),
	limits: Type.Optional(Type.Object({
		timeoutMs: Type.Optional(Type.Number({ description: "Per-stage timeout in milliseconds." })),
		maxRetries: Type.Optional(Type.Number({ description: "Bounded team node retries after child-call failure." })),
		maxLoops: Type.Optional(Type.Number({ description: "Maximum research loops. Explicit values take precedence over profile defaults." })),
	})),
});

function refreshTeamWidget(ctx: ExtensionContext, stateManager: TeamStateManager, runId: string): void {
	const run = stateManager.get(runId);
	if (!run) return;

	const isActive = run.status === "running" || run.status === "pending" || run.status === "stopping";
	const time = isActive
		? formatElapsed(run.startedAt)
		: `${run.status} in ${formatElapsed(run.startedAt, run.completedAt)}`;
	const phase = run.phases.at(-1) ?? "starting";
	const artifacts = run.details.filter((detail) => detail.kind === "artifact" && detail.artifactUri).map((detail) => detail.artifactUri);
	const nodes = run.nodes.map((node) => {
		const stalled = computeNodeStall(node).stalled;
		const status = stalled ? "stalled" : node.status ?? (node.ok ? "completed" : "failed");
		return `${node.role} (${node.model})=${status} ${nodeElapsed(node)}`;
	}).join(" | ");

	ctx.ui.setWidget(`team:${runId}`, [
		`${run.team} (${run.protocol}) · ${run.status} · ${phase} · ${time}`,
		`nodes: ${nodes || "starting"}`,
		...(artifacts.length > 0 ? [`artifacts: ${artifacts.join(", ")}`] : []),
		`cancel: /teams stop ${runId}`,
	]);
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
	resultRoot?: string;
}): Promise<TeamRunToolResult> {
	const team = requireTeam(args.params.id, args.ctx.cwd);
	const handler = getTeamHandler(team);
	if (!handler) {
		throw new Error(`Team "${team.id}" has unsupported protocol ${team.protocol}.`);
	}
	const startedAt = Date.now();
	const runId = args.stateManager.startRun({ teamId: team.id, protocol: team.protocol, prompt: args.params.prompt });
	const unsubscribe = args.stateManager.subscribe(runId, () => refreshTeamWidget(args.ctx, args.stateManager, runId));

	try {
		refreshTeamWidget(args.ctx, args.stateManager, runId);
		const controller = new AbortController();
		args.stateManager.registerAbortController(runId, controller);
		const result = await handler.run({
			team,
			params: args.params,
			ctx: args.ctx,
			stateManager: args.stateManager,
			runId,
			signal: controller.signal,
		});
		await completeRun({
			runId,
			teamId: team.id,
			startedAt,
			result,
			stateManager: args.stateManager,
			cwd: args.ctx.cwd,
			resultRoot: args.resultRoot,
		});
		return coerceTeamRunResult(result, runId);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		args.stateManager.recordRunFailed(runId, message);
		throw error;
	} finally {
		unsubscribe();
		args.ctx.ui.setWidget(`team:${runId}`, undefined);
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
			const result = await createTeamFiles(params, ctx.cwd);
			return ok(`Team "${result.id}" written to ${result.teamPath}.`, {
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
			const result = await updateTeamModels(params, ctx.cwd);
			return ok(`Team "${result.id}" models updated in ${result.teamPath}.`, {
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
	registerTeamControlTools(pi, registration.stateManager);
	pi.registerTool({
		name: "team_run",
		label: "Run Team",
		description: "Run a declarative team by id. The id selects the team/protocol route; use team_list first if you do not know the team id.",
		promptSnippet: "Run the smallest sufficient declarative team by id",
		promptGuidelines: [
			"Do the work and self-check first. Teams are optional assistance, not approval steps; preserve explicit safety and permission gates.",
			"Use team_run with id=navigator only when a bounded independent review materially helps.",
			"Reserve team_run with id=llm-council for exceptional unresolved tradeoffs or an explicit user request, not routine architecture or API changes.",
			"Use team_run with id=deep-research only for research that needs evidence gathering plus Explorer -> Verifier gap feedback -> Synthesis.",
			"Prefer async: true for non-blocking reviews and long research runs; use synchronous calls only when the next step depends on the answer.",
		],
		parameters: TeamRunSchema,
		async execute(_id, params: TeamRunInput, _signal, _onUpdate, ctx) {
			if (params.async) {
				return startTeamRunAsync({ pi, params, ctx, run: (runParams, resultRoot) => runTeam({ params: runParams, ctx, stateManager: registration.stateManager, resultRoot }) });
			}
			try {
				return await runTeam({ params, ctx, stateManager: registration.stateManager });
			} finally {
				ctx.ui.setStatus(TEAM_STATUS_KEY, "teams: ready");
			}
		},
	});
}
