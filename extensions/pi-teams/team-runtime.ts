/**
 * Mutating team tools and execution dispatch for declarative team specs.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { RuntimeControlPlane, type RuntimeEntityRef } from "../../lib/runtime-control-plane.js";
import { ok } from "../../lib/tool-result.js";
import type { TeamStateManager } from "./state.js";
import { createTeamFiles, deleteTeamFiles, type TeamDeleteInput, type TeamFormInput, type TeamModelsInput, updateTeamModels } from "./team-form.js";
import { getTeamHandler, TEAM_STATUS_KEY, type TeamRunInput } from "./team-handlers.js";
import { formatElapsed } from "./team-handler-shared.js";
import { loadTeamRegistry } from "./team-registry.js";
import type { TeamSpec } from "./team-types.js";

export interface TeamRunRegistration {
	stateManager: TeamStateManager;
	runtime?: RuntimeControlPlane;
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
		navigator: Type.Optional(Type.String({ description: "navigator workflow model id." })),
	}),
	scope: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")], { description: "Where to write the model binding. Defaults to current team scope, or user for built-ins." })),
});

const TeamDeleteSchema = Type.Object({
	id: Type.String({ description: "Team id to delete/dissolve." }),
	scope: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")], { description: "Delete from a specific scope. Defaults to the active user/project team." })),
});

const TeamStopSchema = Type.Object({
	runId: Type.String({ description: "Team run id to mark stopped/failed." }),
	reason: Type.Optional(Type.String({ description: "Reason to record for the stop request." })),
});

const RuntimeStatusSchema = Type.Object({
	kind: Type.Optional(Type.Union([Type.Literal("team_run")], { description: "Runtime entity kind to inspect. Currently supports team_run entities from pi-teams." })),
	id: Type.Optional(Type.String({ description: "Runtime entity id to inspect. Omit to list current team run entities." })),
});

const RuntimeStopSchema = Type.Object({
	kind: Type.Optional(Type.Union([Type.Literal("team_run")], { description: "Runtime entity kind to stop. Currently supports team_run entities from pi-teams." })),
	id: Type.String({ description: "Runtime entity id to stop." }),
	reason: Type.Optional(Type.String({ description: "Reason to record for the stop request." })),
});

const TeamRunSchema = Type.Object({
	id: Type.String({ description: "Team id to run, e.g. llm-council, navigator, deep-research." }),
	prompt: Type.String({ description: "Task, question, or review request for the team." }),

	async: Type.Optional(Type.Boolean({ description: "Return immediately and deliver the team result as a follow-up message." })),
	models: Type.Optional(Type.Object({
		members: Type.Optional(Type.Array(Type.String(), { description: "debate/research member model IDs." })),
		synthesis: Type.Optional(Type.String({ description: "debate/research synthesis model ID." })),
		navigator: Type.Optional(Type.String({ description: "navigator workflow override model id." })),
	})),
	limits: Type.Optional(Type.Object({
		timeoutMs: Type.Optional(Type.Number({ description: "Per-stage timeout in milliseconds." })),
		maxRetries: Type.Optional(Type.Number({ description: "Bounded team node retries after child-call failure." })),
		maxLoops: Type.Optional(Type.Number({ description: "Maximum research feedback loops for protocol=research. Default 2, capped at 5." })),
	})),
});

function refreshTeamWidget(ctx: ExtensionContext, stateManager: TeamStateManager, runId: string) {
	const run = stateManager.get(runId);
	if (!run) return;
	
	const time = run.status === "running" || run.status === "pending" || run.status === "stopping"
		? formatElapsed(run.startedAt)
		: `completed in ${formatElapsed(run.startedAt, run.completedAt)}`;

	const phase = run.phases.length > 0 ? run.phases[run.phases.length - 1] : "starting";
	const nodes = run.nodes.length;
	const details = run.details.length;
	const artifacts = run.details.filter((d) => d.kind === "artifact" && d.artifactUri).map((d) => d.artifactUri);
	const artifactsText = artifacts.length > 0 ? `artifacts: ${artifacts.join(", ")}` : "artifacts: none";

	ctx.ui.setWidget(TEAM_STATUS_KEY, [
		`team: ${run.team} (${run.protocol})`,
		`phase: ${run.status === "running" ? phase : run.status}`,
		`time: ${time}`,
		`action: ${nodes} nodes, ${details} details`,
		artifactsText,
		`cancel: /team stop ${runId}`
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
	runtime?: RuntimeControlPlane;
}) {
	const team = requireTeam(args.params.id, args.ctx.cwd);
	const handler = getTeamHandler(team);
	if (!handler) {
		throw new Error(`Team "${team.id}" has unsupported protocol ${team.protocol}.`);
	}
	const startedAt = Date.now();
	const runId = args.stateManager.startRun({ teamId: team.id, protocol: team.protocol, prompt: args.params.prompt });
	const controller = new AbortController();
	args.stateManager.registerAbortController(runId, controller);
	const runtimeRef = registerTeamRunRuntimeEntity(args.runtime, runId, team, (reason) => {
		args.stateManager.requestStop(runId, reason);
	});
	args.runtime?.updateStatus(runtimeRef, "running");
	
	const progressInterval = setInterval(() => {
		refreshTeamWidget(args.ctx, args.stateManager, runId);
	}, 1000);
	refreshTeamWidget(args.ctx, args.stateManager, runId);

	try {
		const result = await handler.run({
			team,
			params: args.params,
			ctx: args.ctx,
			stateManager: args.stateManager,
			runId,
			signal: controller.signal,
		});
		const text = result.content[0]?.text;
		if (args.stateManager.isStopRequested(runId) || result.details.stopped === true) {
			const reason = typeof result.details.reason === "string" ? result.details.reason : args.stateManager.stopReason(runId) ?? "stop requested";
			args.stateManager.recordRunStopped(runId, Date.now() - startedAt, reason, text);
			args.runtime?.updateStatus(runtimeRef, "stopped");
		} else {
			args.stateManager.recordRunCompleted(runId, Date.now() - startedAt, text);
			args.runtime?.updateStatus(runtimeRef, "completed");
		}
		return result;
	} catch (error) {
		args.stateManager.recordRunFailed(runId, error instanceof Error ? error.message : String(error));
		args.runtime?.updateStatus(runtimeRef, "failed");
		throw error;
	} finally {
		clearInterval(progressInterval);
		args.ctx.ui.setWidget(TEAM_STATUS_KEY, undefined);
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

function registerTeamRunRuntimeEntity(
	runtime: RuntimeControlPlane | undefined,
	runId: string,
	team: TeamSpec,
	stop: (reason: string) => void,
): RuntimeEntityRef {
	const ref: RuntimeEntityRef = { kind: "team_run", id: runId };
	if (!runtime) return ref;
	return runtime.registerEntity({
		...ref,
		label: `${team.id} (${team.protocol})`,
		status: "pending",
		stop,
	});
}

function formatTeamRunRuntimeLine(run: ReturnType<TeamStateManager["list"]>[number]): string {
	return `team_run ${run.id} ${run.team} ${run.protocol} ${run.status} phases=${run.phases.length} nodes=${run.nodes.length} details=${run.details.length}${run.error ? ` error=${run.error}` : ""}`;
}

function requestTeamRunStop(stateManager: TeamStateManager, runtime: RuntimeControlPlane, runId: string, reason: string) {
	const runtimeStopped = runtime.stopEntity({ kind: "team_run", id: runId }, reason);
	const accepted = runtimeStopped || stateManager.requestStop(runId, reason);
	if (!accepted) throw new Error(`No active team run ${runId}`);
	return ok(`Team run ${runId} stopping: ${reason}`, { kind: "team_run", id: runId, runId, reason, status: "stopping" });
}

function registerTeamControlTools(pi: ExtensionAPI, stateManager: TeamStateManager, runtime: RuntimeControlPlane): void {
	pi.registerTool({
		name: "runtime_status",
		label: "Runtime Status",
		description: "Inspect runtime entities from the unified runtime surface. This pi-teams slice exposes team run entities; peer agent health remains available via agent_status.",
		promptSnippet: "Inspect runtime entities",
		parameters: RuntimeStatusSchema,
		async execute(_id, params: { kind?: "team_run"; id?: string }) {
			const runs = stateManager.list();
			const entities = runtime.listEntities().filter((entity) => entity.kind === "team_run");
			if (params.id) {
				const run = runs.find((candidate) => candidate.id === params.id);
				const entity = runtime.inspectEntity({ kind: "team_run", id: params.id });
				if (!run && !entity) throw new Error(`No runtime team_run ${params.id}`);
				return ok(run ? formatTeamRunRuntimeLine(run) : `team_run ${params.id} ${entity?.status ?? "unknown"}`, { entities: entity ? [entity] : [{ kind: "team_run", ...run }] });
			}
			const lines = runs.map(formatTeamRunRuntimeLine);
			return ok(lines.length ? lines.join("\n") : "No runtime team_run entities in current session state.", { entities: entities.length > 0 ? entities : runs.map((run) => ({ kind: "team_run", ...run })) });
		},
	});
	pi.registerTool({
		name: "runtime_stop",
		label: "Runtime Stop",
		description: "Request stop for a runtime entity. This pi-teams slice supports team_run entities and uses the same semantics as team_stop.",
		promptSnippet: "Request a runtime entity stop",
		parameters: RuntimeStopSchema,
		async execute(_id, params: { kind?: "team_run"; id: string; reason?: string }) {
			return requestTeamRunStop(stateManager, runtime, params.id, params.reason ?? "stop requested");
		},
	});
	pi.registerTool({
		name: "team_runs",
		label: "Team Runs",
		description: "Peek current team run progress from session state.",
		promptSnippet: "Peek current team run progress",
		parameters: Type.Object({}),
		async execute() {
			const runs = stateManager.list();
			const lines = runs.map((run) => `${run.id} ${run.team} ${run.protocol} ${run.status} phases=${run.phases.length} nodes=${run.nodes.length} details=${run.details.length}${run.error ? ` error=${run.error}` : ""}`);
			return ok(lines.length ? lines.join("\n") : "No team runs in current session state.", { runs });
		},
	});
	pi.registerTool({
		name: "team_stop",
		label: "Team Stop",
		description: "Request a team run stop. Active pi subprocess child calls receive SIGTERM via AbortSignal; other protocols stop at safe phase boundaries.",
		promptSnippet: "Request a team run stop and mark it stopping",
		parameters: TeamStopSchema,
		async execute(_id, params: { runId: string; reason?: string }) {
			return requestTeamRunStop(stateManager, runtime, params.runId, params.reason ?? "stop requested");
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
			const result = await deleteTeamFiles(params, ctx.cwd);
			return ok(`Team "${result.id}" deleted from ${result.teamPath}.`, {
				...result,
			});
		},
	});
}

export function registerTeamRunTool(
	pi: ExtensionAPI,
	registration: TeamRunRegistration,
): void {
	const runtime = registration.runtime ?? new RuntimeControlPlane();
	registerTeamFormTool(pi);
	registerTeamModelsTool(pi);
	registerTeamDeleteTool(pi);
	registerTeamControlTools(pi, registration.stateManager, runtime);
	pi.registerTool({
		name: "team_run",
		label: "Run Team",
		description: "Run a declarative team by id. Use team_list first if you do not know the team id.",
		promptSnippet: "Run a declarative team by id",
		promptGuidelines: [
			"Use team_run with id=llm-council for high-impact architecture or strategy where disagreement is valuable.",
			"Use team_run with id=deep-research for research that needs Explorer -> Verifier gap feedback -> Synthesis.",
			"Use team_run with id=navigator for lightweight Navigator review.",

		],
		parameters: TeamRunSchema,
		async execute(_id, params: TeamRunInput, _signal, _onUpdate, ctx) {
			if (params.async) {
				void runTeam({ params: { ...params, async: undefined }, ctx, stateManager: registration.stateManager, runtime })
					.then((result) => {
						const text = result.content.map((entry) => entry.text).join("\n");
						pi.sendUserMessage(`[Team "${params.id}" async result]\n\n${text}`, { deliverAs: "followUp" });
					})
					.catch((error: unknown) => {
						pi.sendUserMessage(`[Team "${params.id}" async failed]\n\n${error instanceof Error ? error.message : String(error)}`, { deliverAs: "followUp" });
					})
					.finally(() => ctx.ui.setStatus(TEAM_STATUS_KEY, "teams: ready"));
				return ok(`Team "${params.id}" started asynchronously. Result will arrive as a follow-up message.`, { team: params.id, async: true });
			}
			try {
				return await runTeam({ params, ctx, stateManager: registration.stateManager, runtime });
			} finally {
				ctx.ui.setStatus(TEAM_STATUS_KEY, "teams: ready");
			}
		},
	});
}
