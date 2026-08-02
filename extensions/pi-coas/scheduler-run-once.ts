/** Single scheduled-run execution: delivery guard, approval, prompt dispatch, and logging. */

import { hostname } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { activeIdentity, shouldDeliver } from "./scheduler-delivery.js";
import { appendScheduleLog } from "./scheduler-log.js";
import { renderPromptWithMarker } from "./scheduler-prompt.js";
import { saveRunState } from "./scheduler-run-state.js";
import { scheduleRunsPath } from "./schedules.js";
import { isoUtc } from "./store.js";
import { openApprovalGate, requiresPrincipalApproval } from "./scheduler-approval.js";
import { newRunId } from "./scheduler-util.js";
import type { CoasConfig, ScheduleEntry } from "./types.js";

interface RunOnceContext {
	readonly pi: ExtensionAPI;
	readonly config: CoasConfig;
	readonly schedule: ScheduleEntry;
	readonly now: Date;
	readonly registerActiveRun: (runId: string, startedAt: string, approvalRequestId?: string) => void;
}

export interface RunOnceMetrics {
	droppedScheduleRuns: number;
	failedCount: number;
	queuedCount: number;
	lastTaskId?: string;
	lastFailedAt?: string;
	lastQueuedAt?: string;
	lastError?: string;
}

interface RunOnceResult {
	queued: boolean;
	runId?: string;
	approvalRequestId?: string;
}

export async function runOncePerMinute(ctx: RunOnceContext, metrics: RunOnceMetrics): Promise<RunOnceResult> {
	const { pi, config, schedule, now, registerActiveRun } = ctx;
	const identity = activeIdentity(pi);
	const { deliver, reason } = shouldDeliver(schedule, identity);
	const identityLog = `session=${identity.agentName || "unknown"} workspace=${identity.workspaceId || "unknown"} scope=${identity.scope}`;
	if (!deliver) {
		metrics.droppedScheduleRuns++;
		metrics.lastTaskId = schedule.taskId;
		metrics.lastFailedAt = isoUtc();
		await appendScheduleLogBestEffort(config, schedule.taskId, `DROPPED ${identityLog} reason=${reason}`, metrics);
		return { queued: false };
	}

	const priorSummary = schedule.continuation ? await import("./scheduler-run-state.js").then((m) => m.readPriorSummary(config, schedule, now)) : undefined;
	const runId = newRunId();
	const prompt = renderPromptWithMarker(schedule, runId, priorSummary);
	let approvalRequestId: string | undefined;
	if (requiresPrincipalApproval(schedule, prompt)) {
		const gate = await openApprovalGate({ pi, config, schedule, runId, prompt, now });
		if (gate.parked) return { queued: false, runId, approvalRequestId: gate.approvalRequestId };
		if (!gate.approved) return { queued: false };
		approvalRequestId = gate.approvalRequestId;
	}

	if (schedule.continuation || approvalRequestId) {
		const path = scheduleRunsPath(config, schedule.taskId);
		const startedAt = isoUtc(now);
		await saveRunState(path, {
			taskId: schedule.taskId,
			runId,
			...(approvalRequestId ? { requestId: approvalRequestId } : {}),
			status: "running",
			startedAt,
			lastUpdatedAt: startedAt,
		});
		registerActiveRun(runId, startedAt, approvalRequestId);
	}

	try {
		pi.sendUserMessage(prompt, { deliverAs: "followUp" });
	} catch (error) {
		metrics.failedCount++;
		metrics.lastFailedAt = isoUtc();
		metrics.lastTaskId = schedule.taskId;
		metrics.lastError = (error as Error).message;
		if (schedule.continuation || approvalRequestId) {
			await saveRunState(scheduleRunsPath(config, schedule.taskId), {
				taskId: schedule.taskId,
				runId,
				...(approvalRequestId ? { requestId: approvalRequestId } : {}),
				status: "interrupted",
				startedAt: isoUtc(now),
				reason: `send_failed: ${(error as Error).message}`,
				lastUpdatedAt: isoUtc(),
			});
		}
		await appendScheduleLogBestEffort(config, schedule.taskId, `FAILED internal ${(error as Error).message}`, metrics);
		return { queued: false, runId, approvalRequestId };
	}

	metrics.queuedCount++;
	metrics.lastQueuedAt = isoUtc();
	metrics.lastTaskId = schedule.taskId;
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
