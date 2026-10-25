/**
 * Durable approval-inbox claim-check artifacts for gated Automations runs.
 *
 * The on-disk contract (path, schema, parsing, read/write, principal rule) is
 * shared with the Agent Hub view in `lib/automations-approval-inbox.ts`. This
 * module owns the Automations policy on top of it: claim-check gating, parking,
 * decisions, retention and removal.
 */

import { randomUUID } from "node:crypto";
import {
	APPROVAL_ARTIFACT_VERSION,
	approvalArtifactPath,
	isPendingApproval,
	isPrincipal,
	isSafeApprovalRunId,
	readApprovalArtifacts,
	readApprovalArtifact,
	removeApprovalArtifacts,
	sanitizeApprovalText,
	writeApprovalArtifact,
	type ApprovalArtifact,
	type ApprovalStatus,
} from "../../lib/automations-approval-inbox.js";
import { withAdvisoryLock } from "../../lib/file-lock.js";
import { assertSafeId, isoUtc } from "./store-paths.js";
import type { AutomationsConfig } from "./types.js";

const RETENTION_DAYS = 30;
const MAX_TERMINAL_ARTIFACTS = 100;

export { readApprovalArtifact, writeApprovalArtifact, isPrincipal };

interface ApprovalRequest {
	readonly config: AutomationsConfig;
	readonly taskId: string;
	readonly runId: string;
	readonly prompt: string;
	readonly claimToken?: string;
	readonly slotKey?: string;
	readonly requestId?: string;
}

interface ApprovalGateRequest {
	readonly config: AutomationsConfig;
	readonly required: boolean;
	readonly requestId: string;
	readonly taskId: string;
	readonly runId: string;
	readonly prompt: string;
	readonly claimToken?: string;
	readonly slotKey?: string;
}

interface ApprovalGateResult {
	readonly requestId?: string;
	readonly parked: boolean;
	readonly approved: boolean;
}

export async function claimApproval(request: ApprovalGateRequest): Promise<ApprovalGateResult> {
	if (!request.required) return { parked: false, approved: true };
	const requestId = request.requestId;
	const approval = await readApprovalArtifact(request.config, requestId);
	if (!approval) {
		await parkApproval({ ...request, requestId });
		return { requestId, parked: true, approved: false };
	}
	if (request.claimToken !== undefined && approval.claimToken !== request.claimToken) {
		return { requestId, parked: false, approved: false };
	}
	return { requestId, parked: false, approved: approval.status === "approved" };
}

export async function parkApproval(request: ApprovalRequest): Promise<ApprovalArtifact> {
	const requestId = request.requestId ?? `${request.taskId}-${request.runId}`;
	const existing = await readApprovalArtifact(request.config, requestId);
	if (existing) return existing;
	const now = isoUtc();
	assertSafeId("task id", request.taskId);
	if (!isSafeApprovalRunId(request.runId)) throw new Error(`Invalid run id: ${request.runId}`);
	const artifact: ApprovalArtifact = {
		version: APPROVAL_ARTIFACT_VERSION,
		requestId,
		taskId: request.taskId,
		runId: request.runId,
		claimToken: request.claimToken ?? randomUUID(),
		...(request.slotKey ? { slotKey: request.slotKey } : {}),
		status: "awaiting-approval",
		prompt: sanitizeApprovalText(request.prompt, 4_000),
		createdAt: now,
		updatedAt: now,
	};
	await writeApprovalArtifact(request.config, artifact);
	return artifact;
}

async function decide(
	config: AutomationsConfig,
	requestId: string,
	status: ApprovalStatus,
	decision?: string,
): Promise<ApprovalArtifact> {
	if (!isPrincipal()) throw new Error("Approval decisions require principal authority");
	return withAdvisoryLock(approvalArtifactPath(config, requestId), async () => {
		const current = await readApprovalArtifact(config, requestId);
		if (!current) throw new Error(`Unknown approval request: ${requestId}`);
		if (
			current.status === "completed" ||
			current.status === "rejected" ||
			current.status === "deferred" ||
			(current.status === "approved" && status !== "approved")
		) {
			return current;
		}
		if (current.status === status) return current;
		const next: ApprovalArtifact = {
			...current,
			status,
			updatedAt: isoUtc(),
			...(decision ? { decision: sanitizeApprovalText(decision, 500) } : {}),
		};
		await writeApprovalArtifact(config, next);
		return next;
	});
}

function requirePrincipal(): void {
	if (!isPrincipal()) throw new Error("Approval decisions require principal authority");
}

export async function approveApproval(config: AutomationsConfig, requestId: string, decision?: string): Promise<ApprovalArtifact> {
	requirePrincipal();
	return decide(config, requestId, "approved", decision);
}
export async function rejectApproval(config: AutomationsConfig, requestId: string, decision?: string): Promise<ApprovalArtifact> {
	requirePrincipal();
	return decide(config, requestId, "rejected", decision);
}
export async function deferApproval(config: AutomationsConfig, requestId: string, decision?: string): Promise<ApprovalArtifact> {
	requirePrincipal();
	return decide(config, requestId, "deferred", decision);
}

export async function countAwaitingApprovals(config: AutomationsConfig): Promise<number> {
	const artifacts = await listApprovalArtifacts(config);
	return artifacts.filter((artifact) => isPendingApproval(artifact.status)).length;
}

export async function removeApprovalArtifactsForTask(config: AutomationsConfig, taskId: string): Promise<void> {
	assertSafeId("task id", taskId);
	const artifacts = await readApprovalArtifacts(config);
	await removeApprovalArtifacts(
		config,
		artifacts.filter((artifact) => artifact.taskId === taskId).map((artifact) => artifact.requestId),
	);
}

/**
 * Inbox listing with Automations retention: terminal artifacts beyond the newest
 * 100 or older than 30 days are deleted while listing.
 */
export async function listApprovalArtifacts(config: AutomationsConfig): Promise<ApprovalArtifact[]> {
	const sorted = await readApprovalArtifacts(config);
	const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
	const terminal = sorted.filter((item) => item.status === "completed" || item.status === "rejected");
	const retainedTerminal = terminal.slice(-MAX_TERMINAL_ARTIFACTS);
	const retained = new Set(retainedTerminal.map((item) => item.requestId));
	const expired = terminal
		.filter((item) => !retained.has(item.requestId) || Date.parse(item.updatedAt) < cutoff)
		.map((item) => item.requestId);
	await removeApprovalArtifacts(config, expired);
	return sorted.filter(
		(item) => isPendingApproval(item.status) || item.status === "approved" || retained.has(item.requestId),
	);
}
