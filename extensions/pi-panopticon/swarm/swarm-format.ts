/** Human-readable preflight formatting for bounded swarm dry runs. */

import type { SwarmPlan, SwarmRecord, SwarmTask } from "./swarm-types.js";

const DEFAULT_WIP = 3;
const HARD_WIP_CAP = 3;

function boundedWip(wip: number): number {
	if (!Number.isInteger(wip) || wip < 1) return 1;
	return Math.min(wip, HARD_WIP_CAP);
}

function formatTask(task: SwarmTask, ordinal: number): string {
	const mode = task.readOnly ? "read-only" : "write-enabled";
	const dependencies =
		task.dependencies.length === 0 ? "none" : task.dependencies.join(", ");
	return `${ordinal}. ${task.id} — ${task.title} | ${mode} | depends on: ${dependencies} | review: ${task.reviewProfile}`;
}

function dependenciesReady(task: SwarmTask, plan: SwarmPlan): boolean {
	return task.dependencies.every(
		(dependency) => plan.tasks.find((candidate) => candidate.id === dependency)?.state === "done",
	);
}

function formatTaskProgress(task: SwarmTask, plan: SwarmPlan): string {
	const readiness = dependenciesReady(task, plan) ? "ready" : "waiting";
	const worker = task.workerName ?? "unassigned";
	return `${task.id} | ${task.state} | dependencies: ${readiness} | worker: ${worker} | repairs: ${task.repairCycles} | review: ${task.reviewProfile} | artifacts: ${task.artifacts.length}`;
}

function taskCounts(record: SwarmRecord): string {
	const tasks = record.plan.tasks;
	const active = tasks.filter((task) => task.state === "pending" || task.state === "in_progress").length;
	const complete = tasks.filter((task) => task.state === "done").length;
	const blocked = tasks.filter((task) => task.state === "blocked").length;
	return `active ${active}; complete ${complete}; blocked ${blocked}; failed 0`;
}

function terminalReason(record: SwarmRecord): string | undefined {
	return record.stopReason ?? record.plan.blockedReason;
}

/** Formats an agent-readable progress overview without worker briefs or evidence. */
export function formatSwarmProgress(record: SwarmRecord): string {
	const reason = terminalReason(record);
	return [
		`Swarm ${record.plan.swarmId} | state: ${record.state}`,
		`Goal: ${record.plan.goal}`,
		`Profile: ${record.config.profile} | WIP: ${record.config.wip}`,
		`Tasks: ${taskCounts(record)}`,
		...record.plan.tasks.map((task) => formatTaskProgress(task, record.plan)),
		...(reason ? [`Reason: ${reason}`] : []),
	].join("\n");
}

/** Formats one compact progress summary per swarm record. */
export function formatSwarmList(records: SwarmRecord[]): string {
	if (records.length === 0) return "0 swarm(s).";
	return records
		.map((record) => {
			const reason = terminalReason(record);
			return `Swarm ${record.plan.swarmId} | ${record.state} | ${record.plan.goal} | ${record.config.profile} | WIP ${record.config.wip} | tasks: ${taskCounts(record)}${reason ? ` | reason: ${reason}` : ""}`;
		})
		.join("\n");
}

/** Formats a compact, non-executing swarm preflight summary. */
export function formatSwarmDryRun(
	plan: SwarmPlan,
	requestedWip?: number,
): string {
	const requested = requestedWip ?? DEFAULT_WIP;
	const effective = boundedWip(requested);
	const planSummary =
		plan.state === "blocked"
			? `blocked — ${plan.blockedReason ?? "no actionable tasks"} (0 task(s))`
			: `${plan.tasks.length} task(s), sequential dependency order`;
	const rerun = JSON.stringify({
		goal: plan.goal,
		profile: plan.profile,
		wip: requested,
		dry_run: false,
	});
	const taskRows = plan.tasks.map((task, index) => formatTask(task, index + 1));

	return [
		"Swarm dry run; no workers spawned.",
		`Goal: ${plan.goal}`,
		`Profile: ${plan.profile}`,
		`WIP: requested ${requested}; effective ${effective} (max ${HARD_WIP_CAP}).`,
		`Plan: ${planSummary}.`,
		...taskRows,
		"Bounds: max 6 tasks; WIP ≤3; max 3 repair cycles; TTL/ceiling enforcement.",
		`Next: rerun with dry_run:false using swarm_run(${rerun})`,
	].join("\n");
}
