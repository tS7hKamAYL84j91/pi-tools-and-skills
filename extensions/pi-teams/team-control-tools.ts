/** Team runtime control tools, stall detection, and stop request dispatch. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { RuntimeControlPlane } from "../../lib/runtime-control-plane.js";
import { ok } from "../../lib/tool-result.js";
import type { TeamStateManager } from "./state.js";
import { deleteTeamFiles, type TeamDeleteInput } from "./team-form.js";
import { formatElapsed } from "./team-handler-shared.js";
import type { TeamRunNodeRecord, TeamRunRecord, TeamStopInput } from "./types.js";

const NO_HEARTBEAT_THRESHOLD_MS = 30_000;
const IDLE_STALL_THRESHOLD_MS = 60_000;

interface NodeStallResult {
	stalled: boolean;
	reason?: string;
}

export function computeNodeStall(node: TeamRunNodeRecord, now: number = Date.now()): NodeStallResult {
	if (node.status !== "running") return { stalled: false };
	const sinceLastUpdate = now - (node.updatedAt ?? node.startedAt ?? now);
	if (node.runningWorkers === 0 && sinceLastUpdate > IDLE_STALL_THRESHOLD_MS) return { stalled: true, reason: "idle_stall" };
	if (sinceLastUpdate > NO_HEARTBEAT_THRESHOLD_MS) return { stalled: true, reason: "no_heartbeat" };
	return { stalled: false };
}

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

function currentNode(record: TeamRunRecord): TeamRunNodeRecord | undefined {
	const running = record.nodes.filter((node) => node.status === "running");
	if (running.length > 0) return running[running.length - 1];
	return record.nodes[record.nodes.length - 1];
}

export function nodeElapsed(node: TeamRunNodeRecord): string {
	if (node.status === "running" && node.startedAt) return formatElapsed(node.startedAt);
	if (node.durationMs > 0) return formatElapsed(0, node.durationMs);
	return "0s";
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

function formatTeamRunSummary(summary: TeamRunSummary): string {
	return `summary total=${summary.total} running=${summary.running} pending=${summary.pending} stopping=${summary.stopping} completed=${summary.completed} failed=${summary.failed} stopped=${summary.stopped} artifacts=${summary.artifacts}`;
}

function formatTeamRunLine(run: TeamRunSnapshot): string {
	const counts = classifyNodes(run.nodes);
	const current = currentNode(run);
	const currentText = current ? `${run.phases[run.phases.length - 1] ?? "-"}/${current.nodeId}` : "-";
	return `${run.id} ${run.team} ${run.protocol} ${run.status} phases=${run.phases.length} nodes=${run.nodes.length} (running=${counts.running} stalled=${counts.stalled} done=${counts.done}) details=${run.details.length} current=${currentText}${run.error ? ` error=${run.error}` : ""}`;
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

export function registerTeamControlTools(pi: ExtensionAPI, stateManager: TeamStateManager, runtime: RuntimeControlPlane): void {
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
					return ok(`team_run ${formatTeamRunLine(run)}`, {
						entities: (entity ? [entity] : [Object.assign({ kind: "team_run" as const }, run)]),
						nodes: nodeDetailsList,
						phases: run.phases.length,
						current: current ? { nodeId: current.nodeId, phaseId: run.phases[run.phases.length - 1] } : undefined,
						nodeCounts: counts,
					});
				}
				return ok(`team_run ${params.id} ${entity?.status ?? "unknown"}`, { entities: (entity ? [entity] : [Object.assign({ kind: "team_run" as const }, run)]) });
			}
			const lines = runs.map((run) => `team_run ${formatTeamRunLine(run)}`);
			const summary = summarizeTeamRuns(runs);
			return ok(lines.length ? [formatTeamRunSummary(summary), ...lines].join("\n") : "No runtime team_run entities in current session state.", { entities: (entities.length > 0 ? entities : runs.map((run) => Object.assign({ kind: "team_run" as const }, run))), summary });
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
			const lines = runs.map(formatTeamRunLine);
			const summary = summarizeTeamRuns(runs);
			return ok(lines.length ? [formatTeamRunSummary(summary), ...lines].join("\n") : "No team runs in current session state.", { runs, summary });
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

export function registerTeamDeleteTool(pi: ExtensionAPI): void {
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
