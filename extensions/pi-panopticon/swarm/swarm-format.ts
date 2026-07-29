/** Human-readable dry-run formatting retained for standalone planner tests. */

import type { SwarmPlan, SwarmTask } from "./swarm-types.js";

const DEFAULT_WIP = 3;
const HARD_WIP_CAP = 3;

function boundedWip(wip: number): number {
	if (!Number.isInteger(wip) || wip < 1) return 1;
	return Math.min(wip, HARD_WIP_CAP);
}

function formatTask(task: SwarmTask, ordinal: number): string {
	const mode = task.readOnly ? "read-only" : "write-enabled";
	const dependencies = task.dependencies.length === 0 ? "none" : task.dependencies.join(", ");
	return `${ordinal}. ${task.id} — ${task.title} | ${mode} | depends on: ${dependencies} | review: ${task.reviewProfile}`;
}

/** Formats a compact, non-executing standalone planner summary. */
export function formatSwarmDryRun(plan: SwarmPlan, requestedWip?: number): string {
	const requested = requestedWip ?? DEFAULT_WIP;
	const effective = boundedWip(requested);
	const planSummary = plan.state === "blocked"
		? `blocked — ${plan.blockedReason ?? "no actionable tasks"} (0 task(s))`
		: `${plan.tasks.length} task(s), sequential dependency order`;
	const rerun = JSON.stringify({ goal: plan.goal, profile: plan.profile, wip: requested, dry_run: false });
	return [
		"Swarm dry run; no workers spawned.",
		`Goal: ${plan.goal}`,
		`Profile: ${plan.profile}`,
		`WIP: requested ${requested}; effective ${effective} (max ${HARD_WIP_CAP}).`,
		`Plan: ${planSummary}.`,
		...plan.tasks.map((task, index) => formatTask(task, index + 1)),
		"Bounds: max 6 tasks; WIP ≤3; max 3 repair cycles; TTL/ceiling enforcement.",
		`Next: rerun with dry_run:false using swarm_run(${rerun})`,
	].join("\n");
}
