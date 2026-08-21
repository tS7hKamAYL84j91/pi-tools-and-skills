/** Approval-inbox helpers shared by the panopticon agent detail overlay. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { withAdvisoryLock } from "../../../lib/file-lock.js";
import { ConfinedStore } from "../../../lib/confined-store.js";
import { assertSafeId, isoUtc } from "./coas-paths.js";
import { loadRunState, saveRunState, type ScheduleRunState } from "./coas-run-state.js";
import type { CoasConfig } from "../../../lib/coas-types.js";
import { readScheduleTargetAgent } from "./coas-schedule-target.js";

const INBOX_DIR = "schedule-runs/awaiting-approval";

export interface PendingApproval {
	readonly requestId: string;
	readonly taskId: string;
	readonly runId: string;
	readonly prompt: string;
	readonly createdAt: string;
	readonly status: "awaiting-approval" | "deferred";
}

interface ApprovalArtifact {
	readonly requestId: string;
	readonly taskId: string;
	readonly runId: string;
	readonly status: PendingApproval["status"] | "approved" | "rejected" | "completed";
	readonly prompt: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

interface AgentIdentity {
	readonly id: string;
	readonly name: string;
	readonly spawn_name?: string;
}

function approvalArtifactPath(config: CoasConfig, requestId: string): string {
	assertSafeId("approval request id", requestId);
	return join(config.coasHome, INBOX_DIR, `${requestId}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPendingStatus(value: unknown): value is PendingApproval["status"] {
	return value === "awaiting-approval" || value === "deferred";
}

function isArtifact(value: unknown): value is ApprovalArtifact {
	if (!isRecord(value)) return false;
	return (
		typeof value.requestId === "string" &&
		typeof value.taskId === "string" &&
		typeof value.runId === "string" &&
		typeof value.prompt === "string" &&
		typeof value.createdAt === "string" &&
		typeof value.updatedAt === "string" &&
		typeof value.status === "string"
	);
}

async function readAgentApprovalArtifact(
	config: CoasConfig,
	requestId: string,
): Promise<ApprovalArtifact | undefined> {
	const store = await ConfinedStore.openRoot(config.coasHome);
	if (!store) return undefined;
	const raw = await store.readOptionalFile(approvalArtifactPath(config, requestId));
	if (raw === undefined) return undefined;
	try {
		const parsed = JSON.parse(raw) as unknown;
		return isArtifact(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

async function writeAgentApprovalArtifact(config: CoasConfig, artifact: ApprovalArtifact): Promise<void> {
	const store = await ConfinedStore.createRoot(config.coasHome);
	await store.writePrivateFileAtomic(
		approvalArtifactPath(config, artifact.requestId),
		`${JSON.stringify(artifact, null, 2)}\n`,
	);
}

export function isPrincipal(): boolean {
	return process.env.PI_PRINCIPAL === "1";
}

export async function listAgentApprovals(
	config: CoasConfig,
	record: AgentIdentity,
	selfId: string,
): Promise<PendingApproval[]> {
	const store = await ConfinedStore.openRoot(config.coasHome);
	const root = join(config.coasHome, INBOX_DIR);
	if (!store || !await store.fileExists(root)) return [];
	const results: PendingApproval[] = [];
	for (const entry of await store.readDirectory(root)) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
		const requestId = entry.name.slice(0, -5);
		const artifact = await readAgentApprovalArtifact(config, requestId);
		if (!artifact || !isPendingStatus(artifact.status)) continue;
		const targetAgent = await readScheduleTargetAgent(config, artifact.taskId);
		const matches = targetAgent
			? record.name === targetAgent || record.spawn_name === targetAgent
			: record.id === selfId;
		if (!matches) continue;
		results.push({
			requestId: artifact.requestId,
			taskId: artifact.taskId,
			runId: artifact.runId,
			prompt: artifact.prompt,
			createdAt: artifact.createdAt,
			status: artifact.status,
		});
	}
	return results;
}

type ApprovalDecision = "approved" | "rejected" | "deferred";

async function decideAgentApproval(
	config: CoasConfig,
	requestId: string,
	status: ApprovalDecision,
): Promise<PendingApproval | undefined> {
	if (!isPrincipal()) throw new Error("Approval decisions require principal authority");
	return withAdvisoryLock(approvalArtifactPath(config, requestId), async () => {
		const current = await readAgentApprovalArtifact(config, requestId);
		if (!current) throw new Error(`Unknown approval request: ${requestId}`);
		if (
			current.status === "completed" ||
			current.status === "rejected" ||
			current.status === "deferred" ||
			(current.status === "approved" && status !== "approved")
		) {
			return isPendingStatus(current.status) ? (current as PendingApproval) : undefined;
		}
		if (current.status === status) return isPendingStatus(current.status) ? (current as PendingApproval) : undefined;
		const next: ApprovalArtifact = { ...current, status, updatedAt: isoUtc() };
		await writeAgentApprovalArtifact(config, next);
		return isPendingStatus(next.status) ? (next as PendingApproval) : undefined;
	});
}

export async function approveAgentApproval(
	config: CoasConfig,
	requestId: string,
): Promise<PendingApproval | undefined> {
	return decideAgentApproval(config, requestId, "approved");
}

export async function rejectAgentApproval(
	config: CoasConfig,
	requestId: string,
): Promise<PendingApproval | undefined> {
	return decideAgentApproval(config, requestId, "rejected");
}

export async function deferAgentApproval(
	config: CoasConfig,
	requestId: string,
): Promise<PendingApproval | undefined> {
	return decideAgentApproval(config, requestId, "deferred");
}

export async function resumeAgentApproval(
	pi: ExtensionAPI,
	config: CoasConfig,
	requestId: string,
): Promise<boolean> {
	const approval = await readAgentApprovalArtifact(config, requestId);
	if (!approval || approval.status !== "approved") return false;
	const state = await loadRunState(config, approval.taskId);
	if (!state || state.status !== "awaiting-approval" || state.runId !== approval.runId || (state.requestId ?? requestId) !== requestId) {
		return false;
	}
	const runningState: ScheduleRunState = { ...state, status: "running", lastUpdatedAt: isoUtc() };
	await saveRunState(config, approval.taskId, runningState);
	try {
		pi.sendUserMessage(approval.prompt, { deliverAs: "followUp" });
		return true;
	} catch (error) {
		await saveRunState(config, approval.taskId, { ...state, status: "interrupted", reason: `resume_failed: ${(error as Error).message}`, lastUpdatedAt: isoUtc() });
		return false;
	}
}
