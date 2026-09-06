/** Team status and cancellation derive exclusively from session-backed team state. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok } from "../../lib/tool-result.js";
import type { TeamStateManager } from "./state.js";
import { deleteTeamFiles, type TeamDeleteInput } from "./team-form.js";
import { formatElapsed } from "./team-handler-shared.js";
import type { TeamRunNodeRecord, TeamRunRecord, TeamStopInput } from "./types.js";

const NO_HEARTBEAT_THRESHOLD_MS = 30_000;
const IDLE_STALL_THRESHOLD_MS = 60_000;

export function computeNodeStall(node: TeamRunNodeRecord, now: number = Date.now()): { stalled: boolean; reason?: string } {
	if (node.status !== "running") return { stalled: false };
	const sinceLastUpdate = now - (node.updatedAt ?? node.startedAt ?? now);
	if (node.runningWorkers === 0 && sinceLastUpdate > IDLE_STALL_THRESHOLD_MS) return { stalled: true, reason: "idle_stall" };
	if (sinceLastUpdate > NO_HEARTBEAT_THRESHOLD_MS) return { stalled: true, reason: "no_heartbeat" };
	return { stalled: false };
}

function classifyNodes(nodes: readonly TeamRunNodeRecord[]) {
	let running = 0, stalled = 0, done = 0;
	for (const node of nodes) {
		if (node.status === "running") {
			running++;
			if (computeNodeStall(node).stalled) stalled++;
		} else done++;
	}
	return { total: nodes.length, running, stalled, done };
}

function currentNode(record: TeamRunRecord): TeamRunNodeRecord | undefined {
	return record.nodes.filter((node) => node.status === "running").at(-1) ?? record.nodes.at(-1);
}

export function nodeElapsed(node: TeamRunNodeRecord): string {
	if (node.status === "running" && node.startedAt) return formatElapsed(node.startedAt);
	if (node.durationMs > 0) return formatElapsed(0, node.durationMs);
	return "0s";
}

export function summarizeTeamRuns(runs: TeamRunRecord[]) {
	const summary = { total: runs.length, running: 0, pending: 0, stopping: 0, completed: 0, failed: 0, stopped: 0, artifacts: 0 };
	for (const run of runs) {
		if (run.status in summary) summary[run.status as keyof Omit<typeof summary, "total" | "artifacts">] += 1;
		summary.artifacts += run.details.filter((detail) => detail.kind === "artifact" && detail.artifactUri).length;
	}
	return summary;
}

function formatTeamRunLine(run: TeamRunRecord): string {
	const counts = classifyNodes(run.nodes);
	const current = currentNode(run);
	const currentText = current ? `${run.phases.at(-1) ?? "-"}/${current.nodeId}` : "-";
	return `${run.id} ${run.team} ${run.protocol} ${run.status} phases=${run.phases.length} nodes=${run.nodes.length} (running=${counts.running} stalled=${counts.stalled} done=${counts.done}) details=${run.details.length} current=${currentText}${run.error ? ` error=${run.error}` : ""}`;
}

export function readTeamRuns(stateManager: TeamStateManager, runId?: string) {
	const runs = stateManager.list().filter((run) => !runId || run.id === runId);
	if (runId && runs.length === 0) throw new Error(`No team run ${runId}`);
	const summary = summarizeTeamRuns(runs);
	const heading = `summary total=${summary.total} running=${summary.running} pending=${summary.pending} stopping=${summary.stopping} completed=${summary.completed} failed=${summary.failed} stopped=${summary.stopped} artifacts=${summary.artifacts}`;
	return ok(runs.length ? [heading, ...runs.map(formatTeamRunLine)].join("\n") : "No team runs in current session state.", { runs, summary });
}

export function requestTeamRunStop(stateManager: TeamStateManager, runId: string | undefined, reason: string) {
	const resolvedRunId = runId ?? stateManager.newestActiveRun()?.id;
	if (!resolvedRunId || !stateManager.requestStop(resolvedRunId, reason)) throw new Error(`No active team run${resolvedRunId ? ` ${resolvedRunId}` : ""}`);
	const recordedReason = stateManager.stopReason(resolvedRunId) ?? reason;
	return ok(`Team run ${resolvedRunId} stopping: ${recordedReason}`, { kind: "team_run" as const, id: resolvedRunId, runId: resolvedRunId, reason: recordedReason, status: "stopping" });
}

export function registerTeamControlTools(pi: ExtensionAPI, stateManager: TeamStateManager): void {
	pi.registerTool({
		name: "team_runs",
		label: "Team Runs",
		description: "Inspect team runs in the current session, or one run by runId. Uses the same state as cancellation and restored session history.",
		promptSnippet: "Inspect current-session team run status",
		parameters: Type.Object({ runId: Type.Optional(Type.String({ description: "Team run id; omit to list runs." })) }),
		async execute(_id, params) { return readTeamRuns(stateManager, params.runId); },
	});
	pi.registerTool({
		name: "team_stop",
		label: "Team Stop",
		description: "Stop an active team run, defaulting to the newest active run. Aborts active child calls; completed, failed and stopped runs cannot be stopped again.",
		promptSnippet: "Stop an active team run",
		parameters: Type.Object({
			runId: Type.Optional(Type.String({ description: "Team run id; omit for the newest active run." })),
			reason: Type.Optional(Type.String({ description: "Reason for stopping." })),
		}),
		async execute(_id, params: TeamStopInput) { return requestTeamRunStop(stateManager, params.runId, params.reason ?? "stop requested"); },
	});
}

export function registerTeamDeleteTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "team_delete",
		label: "Delete Team",
		description: "Delete/dissolve a user or project team by id. Built-in teams cannot be deleted.",
		promptSnippet: "Delete or dissolve a user or project team",
		parameters: Type.Object({
			id: Type.String({ description: "Team id to delete/dissolve." }),
			scope: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")], { description: "Defaults to the active user/project team." })),
		}),
		async execute(_id, params: TeamDeleteInput, _signal, _onUpdate, ctx) {
			const result = await deleteTeamFiles(params, ctx.cwd);
			return ok(`Team "${result.id}" deleted from ${result.teamPath}.`, { ...result });
		},
	});
}
