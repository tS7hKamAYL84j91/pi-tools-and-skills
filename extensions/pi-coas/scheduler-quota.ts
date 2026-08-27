/** Quota-aware should-run gate for the pi-coas internal scheduler. */

import { listApprovalArtifacts } from "./approval-inbox.js";
import { appendRunHistory, countRecentOutcomes, loadRunHistory, type ScheduleRunHistoryEntry, type ScheduleRunOutcome } from "./scheduler-run-state.js";
import { isoUtc } from "./store-paths.js";
import type { CoasConfig, ScheduleEntry } from "./types.js";

const DEFAULT_LOOKBACK = 3;
const DIMINISHING_OUTCOMES: readonly ScheduleRunOutcome[] = [
	"awaiting-approval",
	"interrupted",
	"skipped-diminishing",
	"skipped-budget",
	"skipped-pending-approval",
];

interface ShouldRunResult {
	readonly shouldRun: boolean;
	readonly reason: string;
}

interface ShouldRunContext {
	readonly config: CoasConfig;
	readonly schedule: ScheduleEntry;
	readonly now: Date;
}

export async function shouldRunForSchedule(ctx: ShouldRunContext): Promise<ShouldRunResult> {
	const { config, schedule } = ctx;
	const taskId = schedule.taskId;
	const lookback = schedule.lookback ?? DEFAULT_LOOKBACK;

	const history = await loadRunHistory(config, taskId);

	if (schedule.runBudget !== undefined && schedule.runBudget > 0) {
		const queued = (history?.entries ?? []).filter((entry) => entry.outcome === "queued").length;
		if (queued >= schedule.runBudget) {
			return { shouldRun: false, reason: "budget_exhausted" };
		}
	}

	const approvals = await listApprovalArtifacts(config);
	const pending = approvals.find(
		(artifact) => artifact.taskId === taskId && (artifact.status === "awaiting-approval" || artifact.status === "deferred"),
	);
	if (pending) {
		return { shouldRun: false, reason: "pending_approval" };
	}

	for (const outcome of DIMINISHING_OUTCOMES) {
		if (countRecentOutcomes(history ?? { taskId, entries: [] }, outcome, lookback) >= lookback) {
			return { shouldRun: false, reason: `diminishing_returns:${outcome}` };
		}
	}

	return { shouldRun: true, reason: "ok" };
}

export async function recordRunOutcome(args: {
	readonly config: CoasConfig;
	readonly taskId: string;
	readonly runId: string;
	readonly outcome: ScheduleRunOutcome;
	readonly summary?: string;
}): Promise<void> {
	const entry: ScheduleRunHistoryEntry = {
		runId: args.runId,
		startedAt: isoUtc(),
		outcome: args.outcome,
		summary: args.summary,
	};
	await appendRunHistory(args.config, args.taskId, entry);
}
