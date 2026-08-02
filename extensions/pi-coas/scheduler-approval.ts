/** Approval integration for scheduled runs. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { claimApproval, readApprovalArtifact, writeApprovalArtifact } from "./approval-inbox.js";
import { scheduleRunsPath } from "./schedules.js";
import { saveRunState } from "./scheduler-run-state.js";
import { isoUtc } from "./store.js";
import type { CoasConfig, ScheduleEntry } from "./types.js";

const SENSITIVE_SCHEDULE_PATTERN = /\b(send\s+(?:an?\s+)?(?:email|message|request)|(?:git\s+)?(?:push|commit|merge)|(?:access|read|use|retrieve)\s+(?:the\s+)?(?:secret|credential|token|password)|repo(?:sitory)?\s+mutation)\b/i;

export function requiresPrincipalApproval(schedule: ScheduleEntry, prompt: string): boolean {
	return schedule.approvalRequired === true || SENSITIVE_SCHEDULE_PATTERN.test(prompt);
}

interface ApprovalGateResult {
	approvalRequestId: string | undefined;
	approved: boolean;
	parked: boolean;
}

export async function openApprovalGate(
	args: {
		pi: ExtensionAPI;
		config: CoasConfig;
		schedule: ScheduleEntry;
		runId: string;
		prompt: string;
		now: Date;
	},
): Promise<ApprovalGateResult> {
	const approvalRequestId = `${args.schedule.taskId}-${args.runId}`;
	const gate = await claimApproval({
		config: args.config,
		required: true,
		requestId: approvalRequestId,
		taskId: args.schedule.taskId,
		runId: args.runId,
		prompt: args.prompt,
	});
	if (gate.parked) {
		const startedAt = isoUtc(args.now);
		await saveRunState(scheduleRunsPath(args.config, args.schedule.taskId), {
			taskId: args.schedule.taskId,
			runId: args.runId,
			requestId: approvalRequestId,
			status: "awaiting-approval",
			startedAt,
			lastUpdatedAt: startedAt,
		});
		return { approvalRequestId, approved: false, parked: true };
	}
	if (!gate.approved) {
		return { approvalRequestId, approved: false, parked: false };
	}
	return { approvalRequestId, approved: true, parked: false };
}

export async function finalizeApproval(
	config: CoasConfig,
	approvalRequestId: string | undefined,
	status: "complete" | "interrupted",
): Promise<void> {
	if (!approvalRequestId) return;
	const approval = await readApprovalArtifact(config, approvalRequestId);
	if (approval?.status === "approved") {
		await writeApprovalArtifact(config, {
			...approval,
			status: status === "complete" ? "completed" : "deferred",
			updatedAt: isoUtc(),
		});
	}
}
