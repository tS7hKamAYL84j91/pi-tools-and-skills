/** Mutating team tools and execution dispatch for declarative team specs. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { RuntimeControlPlane, type RuntimeEntityRef } from "../../../lib/runtime-control-plane.js";
import { ok } from "../../../lib/tool-result.js";
import type { TeamRunToolResult } from "./team-run-completion.js";
import { completeRun, coerceTeamRunResult } from "./team-run-completion.js";

import type { TeamStateManager } from "./state.js";
import type { TeamRunNodeRecord, TeamRunRecord, TeamStopInput } from "./types.js";
import { createTeamFiles, deleteTeamFiles, type TeamDeleteInput, type TeamFormInput, type TeamModelsInput, updateTeamModels } from "./team-form.js";
import { getTeamHandler, TEAM_STATUS_KEY, type TeamRunInput } from "./team-handlers.js";
import { formatElapsed } from "./team-handler-shared.js";
import { startTeamRunAsync } from "./team-async.js";
import { loadTeamRegistry } from "./team-registry.js";
import type { TeamProfile } from "./team-profiles.js";
import type { TeamSpec } from "./team-types.js";
/** Stall detection thresholds (read-side only, not persisted). */
const NO_HEARTBEAT_THRESHOLD_MS = 30_000;
const IDLE_STALL_THRESHOLD_MS = 60_000;
interface NodeStallResult {
	stalled: boolean;
	reason?: string;
}

/** Compute stall status for a node from its in-memory record. */
export function computeNodeStall(node: TeamRunNodeRecord, now: number = Date.now()): NodeStallResult {
	if (node.status !== "running") return { stalled: false };
	const sinceLastUpdate = now - (node.updatedAt ?? node.startedAt ?? now);
	if (node.runningWorkers === 0 && sinceLastUpdate > IDLE_STALL_THRESHOLD_MS) return { stalled: true, reason: "idle_stall" };
	if (sinceLastUpdate > NO_HEARTBEAT_THRESHOLD_MS) return { stalled: true, reason: "no_heartbeat" };
	return { stalled: false };
}

/** Classify nodes by status for summary counts. */
function classifyNodes(nodes: readonly TeamRunNodeRecord[], now: number = Date.now()): { total: number; running: number; stalled: number; done: number } {
	let running = 0, stalled = 0, done = 0;
	for (const node of nodes) {
		if (node.status === "running") {
			running++;
			if (computeNodeStall(node, now).stalled) stalled++;
		} else {
			done++;
		}
	}
	return { total: nodes.length, running, stalled, done };
}

/** Find the current (most recently started running) node. */
function currentNode(record: TeamRunRecord): TeamRunNodeRecord | undefined {
	const running = record.nodes.filter((node) => node.status === "running");
	if (running.length > 0) return running[running.length - 1];
	return record.nodes[record.nodes.length - 1];
}

/** Format elapsed time for a running node from its startedAt. */
function nodeElapsed(node: TeamRunNodeRecord): string {
	if (node.status === "running" && node.startedAt) return formatElapsed(node.startedAt);
	if (node.durationMs > 0) return formatElapsed(0, node.durationMs);
	return "0s";
}

export interface TeamRunRegistration {
	stateManager: TeamStateManager;
	runtime?: RuntimeControlPlane;
}

const TeamFormSchema = Type.Object({
	id: Type.String({ description: "Team id to create or replace." }),
	name: Type.Optional(Type.String({ description: "Human-readable team name." })),
	description: Type.Optional(Type.String({ description: "Team description." })),
	protocol: Type.Union([Type.Literal("consult"), Type.Literal("debate"), Type.Literal("research"), Type.Literal("fusion-analysis")], { description: "Team protocol for generated team files." }),
	agents: Type.Array(Type.String(), { description: "Subagent ids or explicit live-agent refs (agent:<registered-name>) referenced by the team." }),
	models: Type.Optional(Type.Object({
		members: Type.Optional(Type.Array(Type.String(), { description: "debate member model IDs." })),
		synthesis: Type.Optional(Type.String({ description: "debate/fusion synthesis or judge model." })),
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
		synthesis: Type.Optional(Type.String({ description: "debate/fusion synthesis or judge model." })),
		driver: Type.Optional(Type.String({ description: "driver/fallback model id." })),
		navigator: Type.Optional(Type.String({ description: "navigator workflow model id." })),
	}),
	scope: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")], { description: "Where to write the model binding. Defaults to current team scope, or user for built-ins." })),
});

const TeamDeleteSchema = Type.Object({
	id: Type.String({ description: "Team id to delete/dissolve." }),
	scope: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")], { description: "Delete from a specific scope. Defaults to the active user/project team." })),
});

const TeamStopSchema = Type.Object({
	runId: Type.Optional(Type.String({ description: "Team run id to stop. Omit to stop the newest active run." })),
	reason: Type.Optional(Type.String({ description: "Reason to record for the stop request." })),
});

const RuntimeKindSchema = Type.Literal("team_run");
const RuntimeStatusSchema = Type.Object({
	kind: Type.Optional(RuntimeKindSchema),
	id: Type.Optional(Type.String({ description: "Runtime entity id to inspect. Omit to list entities." })),
});
const RuntimeStopSchema = Type.Object({
	kind: Type.Optional(RuntimeKindSchema),
	id: Type.String({ description: "Runtime entity id to stop." }),
	reason: Type.Optional(Type.String({ description: "Reason to record for the stop request." })),
});

const TeamRunSchema = Type.Object({
	id: Type.String({ description: "Team id to run, e.g. llm-council, navigator, deep-research." }),
	prompt: Type.String({ description: "Task, question, or review request for the team." }),
	profile: Type.Optional(Type.Unsafe<TeamProfile>({ type: "string", enum: ["fast", "balanced", "thorough"], description: "Latency/depth profile. Defaults to balanced; explicit models/limits take precedence." })),

	async: Type.Optional(Type.Boolean({ description: "Return immediately and deliver the team result as a follow-up message." })),
	models: Type.Optional(Type.Object({
		members: Type.Optional(Type.Array(Type.String(), { description: "debate/research/fusion member model IDs." })),
		synthesis: Type.Optional(Type.String({ description: "debate/research/fusion synthesis or judge model ID." })),
		driver: Type.Optional(Type.String({ description: "driver/fallback model ID." })),
		navigator: Type.Optional(Type.String({ description: "navigator workflow override model id." })),
	})),
	limits: Type.Optional(Type.Object({
		timeoutMs: Type.Optional(Type.Number({ description: "Per-stage timeout in milliseconds." })),
		maxRetries: Type.Optional(Type.Number({ description: "Bounded team node retries after child-call failure." })),
		maxLoops: Type.Optional(Type.Number({ description: "Maximum research loops, or legacy Fusion panel-size override. Explicit values take precedence over profile defaults." })),
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
	runtime?: RuntimeControlPlane;
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
	let runtimeRef: RuntimeEntityRef | undefined;

	try {
		refreshTeamWidget(args.ctx, args.stateManager, runId);
		const controller = new AbortController();
		args.stateManager.registerAbortController(runId, controller);
		runtimeRef = registerTeamRunRuntimeEntity(args.runtime, runId, team, (reason) => {
			args.stateManager.requestStop(runId, reason);
		});
		args.runtime?.updateStatus(runtimeRef, "running");
		const result = await handler.run({
			team,
			params: args.params,
			ctx: args.ctx,
			stateManager: args.stateManager,
			runId,
			signal: controller.signal,
		});
		const completion = await completeRun({
			runId,
			teamId: team.id,
			startedAt,
			result,
			stateManager: args.stateManager,
			cwd: args.ctx.cwd,
			resultRoot: args.resultRoot,
		});
		if (runtimeRef) args.runtime?.updateStatus(runtimeRef, completion.status);
		return coerceTeamRunResult(result, runId);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		args.stateManager.recordRunFailed(runId, message);
		if (runtimeRef) args.runtime?.updateStatus(runtimeRef, "failed");
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

type TeamRunSnapshot = ReturnType<TeamStateManager["list"]>[number];

interface TeamRunSummary {
	total: number;
	running: number;
	pending: number;
	stopping: number;
	completed: number;
	failed: number;
	stopped: number;
	artifacts: number;
}

export function summarizeTeamRuns(runs: TeamRunSnapshot[]): TeamRunSummary {
	const summary: TeamRunSummary = { total: runs.length, running: 0, pending: 0, stopping: 0, completed: 0, failed: 0, stopped: 0, artifacts: 0 };
	for (const run of runs) {
		if (run.status in summary) summary[run.status as keyof Omit<TeamRunSummary, "total" | "artifacts">] += 1;
		summary.artifacts += run.details.filter((detail) => detail.kind === "artifact" && detail.artifactUri).length;
	}
	return summary;
}

function formatTeamRunSummary(runs: TeamRunSnapshot[]): string {
	const summary = summarizeTeamRuns(runs);
	return `summary total=${summary.total} running=${summary.running} pending=${summary.pending} stopping=${summary.stopping} completed=${summary.completed} failed=${summary.failed} stopped=${summary.stopped} artifacts=${summary.artifacts}`;
}

function formatTeamRunRuntimeLine(run: TeamRunSnapshot): string {
	const counts = classifyNodes(run.nodes);
	const current = currentNode(run);
	const currentText = current ? `${run.phases[run.phases.length - 1] ?? "-"}/${current.nodeId}` : "-";
	return `team_run ${run.id} ${run.team} ${run.protocol} ${run.status} phases=${run.phases.length} nodes=${run.nodes.length} (running=${counts.running} stalled=${counts.stalled} done=${counts.done}) details=${run.details.length} current=${currentText}${run.error ? ` error=${run.error}` : ""}`;
}

export function requestTeamRunStop(stateManager: TeamStateManager, runtime: RuntimeControlPlane, runId: string | undefined, reason: string) {
	const resolvedRunId = runId ?? stateManager.newestActiveRun()?.id;
	if (!resolvedRunId) throw new Error("No active team run");
	const runtimeStopped = runtime.stopEntity({ kind: "team_run", id: resolvedRunId }, reason);
	const accepted = runtimeStopped || stateManager.requestStop(resolvedRunId, reason);
	if (!accepted) throw new Error(`No active team run ${resolvedRunId}`);
	const run = stateManager.get(resolvedRunId);
	const runningNodes = run?.nodes.filter((node) => node.status === "running") ?? [];
	const nodeLines = runningNodes.map((node) => {
		const stall = computeNodeStall(node);
		return `${node.role} (${node.model}) ${nodeElapsed(node)}${stall.stalled ? ", stalled" : ""}`;
	});
	const text = nodeLines.length > 0
		? `Team run ${resolvedRunId} stopping: ${reason}\nRunning nodes: ${nodeLines.join(", ")}`
		: `Team run ${resolvedRunId} stopping: ${reason}`;
	return ok(text, { kind: "team_run" as const, id: resolvedRunId, runId: resolvedRunId, reason, status: "stopping" });
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
				if (run) {
					const counts = classifyNodes(run.nodes);
					const current = currentNode(run);
					const nodeDetailsList = run.nodes.map((node) => ({
						nodeId: node.nodeId,
						role: node.role,
						model: node.model,
						status: node.status ?? "completed",
						elapsedMs: node.status === "running" && node.startedAt ? Date.now() - node.startedAt : node.durationMs,
						runningWorkers: node.runningWorkers,
						stalled: computeNodeStall(node).stalled,
					}));
					return ok(formatTeamRunRuntimeLine(run), {
						entities: (entity ? [entity] : [Object.assign({ kind: "team_run" as const }, run)]),
						nodes: nodeDetailsList,
						phases: run.phases.length,
						current: current ? { nodeId: current.nodeId, phaseId: run.phases[run.phases.length - 1] } : undefined,
						nodeCounts: counts,
					});
				}
				return ok(`team_run ${params.id} ${entity?.status ?? "unknown"}`, { entities: (entity ? [entity] : [Object.assign({ kind: "team_run" as const }, run)]) });
			}
			const lines = runs.map(formatTeamRunRuntimeLine);
			const summary = summarizeTeamRuns(runs);
			return ok(lines.length ? [formatTeamRunSummary(runs), ...lines].join("\n") : "No runtime team_run entities in current session state.", { entities: (entities.length > 0 ? entities : runs.map((run) => Object.assign({ kind: "team_run" as const }, run))), summary });
		},
	});
	pi.registerTool({
		name: "runtime_stop",
		label: "Runtime Stop",
		description: "Request stop for a runtime entity. This pi-teams slice supports team_run entities and uses the same semantics as team_stop.",
		promptSnippet: "Request a runtime entity stop",
		parameters: RuntimeStopSchema,
		async execute(_id, params: { kind?: "team_run"; id: string; reason?: string }) {
			const reason = params.reason ?? "stop requested";
			return requestTeamRunStop(stateManager, runtime, params.id, reason);
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
			const lines = runs.map((run) => {
				const counts = classifyNodes(run.nodes);
				const current = currentNode(run);
				const currentText = current ? `${run.phases[run.phases.length - 1] ?? "-"}/${current.nodeId}` : "-";
				return `${run.id} ${run.team} ${run.protocol} ${run.status} phases=${run.phases.length} nodes=${run.nodes.length} (running=${counts.running} stalled=${counts.stalled} done=${counts.done}) details=${run.details.length} current=${currentText}${run.error ? ` error=${run.error}` : ""}`;
			});
			return ok(lines.length ? [formatTeamRunSummary(runs), ...lines].join("\n") : "No team runs in current session state.", { runs, summary: summarizeTeamRuns(runs) });
		},
	});
	pi.registerTool({
		name: "team_stop",
		label: "Team Stop",
		description: "Request a team run stop, defaulting to the newest active run when runId is omitted. Active pi subprocess child calls receive SIGTERM via AbortSignal; other protocols stop at safe phase boundaries.",
		promptSnippet: "Request a team run stop and mark it stopping",
		parameters: TeamStopSchema,
		async execute(_id, params: TeamStopInput) {
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
		description: "Run a declarative team by id. The id selects the team/protocol route; use team_list first if you do not know the team id.",
		promptSnippet: "Run the smallest sufficient declarative team by id",
		promptGuidelines: [
			"Choose the smallest sufficient team; do not use teams as a generic autonomous-agent framework.",
			"Use team_run with id=navigator for lightweight focused review.",
			"Use team_run with id=llm-council for architecture, public API, persistence, security, or contested strategy where disagreement is valuable.",
			"Use team_run with id=deep-research only for research that needs evidence gathering plus Explorer -> Verifier gap feedback -> Synthesis.",
			"Prefer async: true for non-blocking reviews and long research runs; use synchronous calls only when the next step depends on the answer.",
		],
		parameters: TeamRunSchema,
		async execute(_id, params: TeamRunInput, _signal, _onUpdate, ctx) {
			if (params.async) {
				return startTeamRunAsync({ pi, params, ctx, run: (runParams, resultRoot) => runTeam({ params: runParams, ctx, stateManager: registration.stateManager, runtime, resultRoot }) });
			}
			try {
				return await runTeam({ params, ctx, stateManager: registration.stateManager, runtime });
			} finally {
				ctx.ui.setStatus(TEAM_STATUS_KEY, "teams: ready");
			}
		},
	});
}
