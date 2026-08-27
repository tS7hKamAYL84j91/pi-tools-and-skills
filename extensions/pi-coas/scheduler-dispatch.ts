/** Dispatch and failure telemetry for one scheduled run. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isoUtc } from "./store-paths.js";
import { runOncePerMinute, type RunOnceMetrics } from "./scheduler-run-once.js";
import type { RunExecutor } from "./scheduler-run-queue.js";
import type { CoasConfig, ScheduleEntry } from "./types.js";

interface ScheduledRunDispatchContext {
	readonly pi: ExtensionAPI;
	readonly config: CoasConfig;
	readonly metrics: RunOnceMetrics;
	readonly canDispatch: () => boolean;
	readonly registerActiveRun: (runId: string, startedAt: string, approvalRequestId?: string) => void;
	readonly incrementAwaitingApproval: () => void;
}

async function dispatchScheduledRun(ctx: ScheduledRunDispatchContext, schedule: ScheduleEntry, now: Date): Promise<void> {
	try {
		const result = await runOncePerMinute({
			pi: ctx.pi,
			config: ctx.config,
			schedule,
			now,
			canDispatch: ctx.canDispatch,
			registerActiveRun: ctx.registerActiveRun,
		}, ctx.metrics);
		if (result.approvalRequestId && !result.queued) ctx.incrementAwaitingApproval();
	} catch (error) {
		ctx.metrics.failedCount++;
		ctx.metrics.lastFailedAt = isoUtc();
		ctx.metrics.lastTaskId = schedule.taskId;
		ctx.metrics.lastError = (error as Error).message;
	}
}

interface RunExecutorDeps {
	readonly pi: ExtensionAPI;
	readonly metrics: RunOnceMetrics;
	readonly workAccepting: () => boolean;
	readonly track: (work: Promise<unknown>) => void;
	readonly config: () => CoasConfig | undefined;
	readonly registerActiveRun: (taskId: string) => (runId: string, startedAt: string, approvalRequestId?: string) => void;
	readonly incrementAwaitingApproval: () => void;
}

/** Builds the run-queue executor: resolve current config, then dispatch one run. */
export function createRunExecutor(deps: RunExecutorDeps): RunExecutor {
	return {
		execute: (schedule, now) => {
			const config = deps.config();
			if (!config) return Promise.resolve();
			return dispatchScheduledRun({
				pi: deps.pi,
				config,
				metrics: deps.metrics,
				canDispatch: deps.workAccepting,
				registerActiveRun: deps.registerActiveRun(schedule.taskId),
				incrementAwaitingApproval: deps.incrementAwaitingApproval,
			}, schedule, now);
		},
		track: deps.track,
	};
}