/** Approval-resume path for scheduled runs. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readApprovalArtifact } from "./approval-inbox.js";
import { loadRunState, saveRunState } from "./scheduler-run-state.js";
import { listSchedules } from "./schedules.js";
import { isoUtc } from "./store-paths.js";
import type { ScheduleSlotState } from "./scheduler-slot-state.js";
import type { CoasConfig } from "./types.js";

interface ActiveScheduledRun {
	readonly taskId: string;
	readonly runId: string;
	readonly startedAt: string;
	readonly approvalRequestId?: string;
}

export interface ResumeContext {
	pi: ExtensionAPI;
	config: CoasConfig | undefined;
	workAccepting: () => boolean;
	metrics: {
		queuedCount: number;
		lastQueuedAt?: string;
		lastTaskId?: string;
		failedCount: number;
		lastFailedAt?: string;
		lastError?: string;
	};
	activeScheduledRuns: Map<string, ActiveScheduledRun>;
	decrementAwaitingApproval: () => void;
	slotState?: ScheduleSlotState;
}

export async function resumeApprovedRunTracked(ctx: ResumeContext, config: CoasConfig, requestId: string): Promise<boolean> {
	const approval = await readApprovalArtifact(config, requestId);
	if (!approval || approval.status !== "approved") return false;
	const state = await loadRunState(config, approval.taskId);
	if (!state || state.status !== "awaiting-approval" || state.runId !== approval.runId || (state.requestId ?? requestId) !== requestId) return false;
	ctx.decrementAwaitingApproval();
	const schedules = await listSchedules(config);
	const schedule = schedules.find((candidate) => candidate.taskId === approval.taskId);
	if (!schedule) return false;
	const claim = approval.slotKey
		? { taskId: approval.taskId, slotKey: approval.slotKey, token: approval.claimToken }
		: undefined;
	if (ctx.slotState && claim) {
		const admitted = await ctx.slotState.approve(claim, new Date());
		if (!admitted) return false;
		// Persist the host-call boundary before invoking the host. A crash after
		// this point must remain blocked rather than replaying the prompt.
		if (!await ctx.slotState.markHostCalled(claim, new Date())) return false;
	}
	ctx.config = config;
	const startedAt = state.startedAt;
	await saveRunState(config, schedule.taskId, { ...state, requestId, status: "running", lastUpdatedAt: isoUtc() });
	ctx.activeScheduledRuns.set(state.runId, { taskId: schedule.taskId, runId: state.runId, startedAt, approvalRequestId: requestId });
	try {
		if (!ctx.workAccepting()) return false;
		ctx.pi.sendUserMessage(approval.prompt, { deliverAs: "followUp" });
		if (ctx.slotState && claim && !await ctx.slotState.markHostCallReturned(claim, new Date())) {
			await ctx.slotState.markUncertain(claim, new Date());
			throw new Error("host-call return transition failed");
		}
		ctx.metrics.queuedCount++;
		ctx.metrics.lastQueuedAt = isoUtc();
		ctx.metrics.lastTaskId = schedule.taskId;
		return true;
	} catch (error) {
		if (ctx.slotState && claim) await ctx.slotState.markUncertain(claim, new Date());
		await saveRunState(config, schedule.taskId, { ...state, requestId, status: "interrupted", reason: `resume_failed: ${(error as Error).message}`, lastUpdatedAt: isoUtc() });
		ctx.activeScheduledRuns.delete(state.runId);
		ctx.metrics.failedCount++;
		ctx.metrics.lastFailedAt = isoUtc();
		ctx.metrics.lastError = (error as Error).message;
		return false;
	}
}
