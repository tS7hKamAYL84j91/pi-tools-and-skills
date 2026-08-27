/** Single scheduled-run execution: delivery guard, approval, prompt dispatch, and logging. */

import { hostname } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { activeIdentity, shouldDeliver } from "./scheduler-delivery.js";
import { modelDriftReason, renderDriftAlert } from "./scheduler-drift.js";
import { appendScheduleLog } from "./scheduler-log.js";
import { renderPromptWithMarker } from "./scheduler-prompt.js";
import { saveRunState } from "./scheduler-run-state.js";
import { recordRunOutcome, shouldRunForSchedule } from "./scheduler-quota.js";
import type { ScheduleRunOutcome } from "./scheduler-run-state.js";
import { isoUtc } from "./store-paths.js";
import { openApprovalGate, requiresPrincipalApproval } from "./scheduler-approval.js";
import { newRunId } from "./scheduler-util.js";
import type { CoasConfig, ScheduleEntry } from "./types.js";

interface RunOnceContext {
	readonly pi: ExtensionAPI;
	readonly config: CoasConfig;
	readonly schedule: ScheduleEntry;
	readonly now: Date;
	readonly canDispatch: () => boolean;
	readonly currentModel?: () => string | undefined;
	readonly registerActiveRun: (runId: string, startedAt: string, approvalRequestId?: string) => void;
}

export interface RunOnceMetrics {
	droppedScheduleRuns: number;
	failedCount: number;
	queuedCount: number;
	skippedRuns: number;
	lastTaskId?: string;
	lastFailedAt?: string;
	lastQueuedAt?: string;
	lastError?: string;
}

interface RunOnceResult {
	queued: boolean;
	runId?: string;
	approvalRequestId?: string;
	reason?: string;
}

export async function runOncePerMinute(ctx: RunOnceContext, metrics: RunOnceMetrics): Promise<RunOnceResult> {
	const { pi, config, schedule, now, registerActiveRun } = ctx;
	const identity = await activeIdentity(pi, config);
	const { deliver, reason } = shouldDeliver(schedule, identity);
	const identityLog = `session=${identity.agentName || "unknown"} workspace=${identity.workspaceId || "unknown"} scope=${identity.scope}`;
	if (!deliver) {
		metrics.droppedScheduleRuns++;
		metrics.lastTaskId = schedule.taskId;
		metrics.lastFailedAt = isoUtc();
		await recordRunOutcome({ config, taskId: schedule.taskId, runId: "none", outcome: "dropped" });
		await appendScheduleLogBestEffort(config, schedule.taskId, `DROPPED ${identityLog} reason=${reason}`, metrics);
		return { queued: false, reason };
	}

	// Model drift guard (fail closed): a schedule pinned to model A must never
	// silently run on a different model. Skip + alert; never mark the run failed.
	const drift = modelDriftReason(schedule.modelSnapshot, ctx.currentModel?.());
	if (drift) {
		metrics.skippedRuns++;
		metrics.lastTaskId = schedule.taskId;
		await recordRunOutcome({ config, taskId: schedule.taskId, runId: "none", outcome: "skipped-drift", summary: drift });
		await appendScheduleLogBestEffort(config, schedule.taskId, `SKIPPED ${identityLog} reason=${drift}`, metrics);
		try {
			pi.sendUserMessage(renderDriftAlert(schedule.taskId, drift), { deliverAs: "followUp" });
		} catch (error) {
			// Alert is best-effort: a failed alert must not turn the skip into a failure.
			metrics.lastError = `drift_alert_failed: ${(error as Error).message}`;
		}
		return { queued: false, reason: drift };
	}

	const quota = await shouldRunForSchedule({ config, schedule, now });
	if (!quota.shouldRun) {
		metrics.skippedRuns++;
		metrics.lastTaskId = schedule.taskId;
		await recordRunOutcome({ config, taskId: schedule.taskId, runId: "none", outcome: quota.reason as ScheduleRunOutcome });
		await appendScheduleLogBestEffort(config, schedule.taskId, `SKIPPED ${identityLog} reason=${quota.reason}`, metrics);
		return { queued: false, reason: quota.reason };
	}

	const priorSummary = schedule.continuation ? await import("./scheduler-run-state.js").then((m) => m.readPriorSummary(config, schedule, now)) : undefined;
	const runId = newRunId();
	const prompt = renderPromptWithMarker(schedule, runId, priorSummary);
	let approvalRequestId: string | undefined;
	if (requiresPrincipalApproval(schedule, prompt)) {
		const gate = await openApprovalGate({ pi, config, schedule, runId, prompt, now });
		if (gate.parked) {
			await recordRunOutcome({ config, taskId: schedule.taskId, runId, outcome: "awaiting-approval" });
			return { queued: false, runId, approvalRequestId: gate.approvalRequestId, reason: "awaiting_approval" };
		}
		if (!gate.approved) return { queued: false, reason: "approval_denied" };
		approvalRequestId = gate.approvalRequestId;
	}

	if (schedule.continuation || approvalRequestId) {
		const startedAt = isoUtc(now);
		await saveRunState(config, schedule.taskId, {
			taskId: schedule.taskId,
			runId,
			...(approvalRequestId ? { requestId: approvalRequestId } : {}),
			status: "running",
			startedAt,
			lastUpdatedAt: startedAt,
		});
		registerActiveRun(runId, startedAt, approvalRequestId);
	}

	if (!ctx.canDispatch()) {
		return { queued: false, runId, approvalRequestId, reason: "dispatch_paused" };
	}

	try {
		pi.sendUserMessage(prompt, { deliverAs: "followUp" });
	} catch (error) {
		metrics.failedCount++;
		metrics.lastFailedAt = isoUtc();
		metrics.lastTaskId = schedule.taskId;
		metrics.lastError = (error as Error).message;
		if (schedule.continuation || approvalRequestId) {
			await saveRunState(config, schedule.taskId, {
				taskId: schedule.taskId,
				runId,
				...(approvalRequestId ? { requestId: approvalRequestId } : {}),
				status: "interrupted",
				startedAt: isoUtc(now),
				reason: `send_failed: ${(error as Error).message}`,
				lastUpdatedAt: isoUtc(),
			});
		}
		await recordRunOutcome({ config, taskId: schedule.taskId, runId, outcome: "interrupted", summary: `send_failed: ${(error as Error).message}` });
		await appendScheduleLogBestEffort(config, schedule.taskId, `FAILED internal ${(error as Error).message}`, metrics);
		return { queued: false, runId, approvalRequestId, reason: "send_failed" };
	}

	metrics.queuedCount++;
	metrics.lastQueuedAt = isoUtc();
	metrics.lastTaskId = schedule.taskId;
	// History is recorded after the send succeeds. A crash in the window between
	// send and record leaves the history without this run's `queued` entry: the
	// budget counter undercounts by one but the run can never double-fire, since
	// run-queue dedupe (taskId + minuteKey) already holds the claim.
	await recordRunOutcome({ config, taskId: schedule.taskId, runId, outcome: "queued" });
	await appendScheduleLogBestEffort(config, schedule.taskId, `QUEUED ${identityLog} host=${hostname()}`, metrics);
	return { queued: true, runId, approvalRequestId };
}

async function appendScheduleLogBestEffort(config: CoasConfig, taskId: string, message: string, metrics: RunOnceMetrics): Promise<void> {
	try {
		await appendScheduleLog(config, taskId, message);
	} catch (error) {
		metrics.lastError = (error as Error).message;
	}
}
