/**
 * Approval-inbox contract shared by Automations and the Agent Hub view.
 *
 * A gated scheduled run parks a durable artifact under
 * `schedule-runs/awaiting-approval/<requestId>.json`; a human (or the principal
 * agent) records a decision on it. Automations owns parking, deciding and
 * pruning; Agent Hub lists and decides the artifacts that belong to one agent.
 * Both sides use this module so the path, schema, safety checks and principal
 * rule are defined once.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { ConfinedStore } from "./confined-store.js";
import { assertRootNotSymlink } from "./confined-store-security.js";
import { withAdvisoryLock } from "./file-lock.js";
import { assertSafeId, isoUtc } from "./automations-paths.js";
import { loadRunState, saveRunState, type ScheduleRunState } from "./automations-run-state.js";
import type { AutomationsConfig } from "./automations-types.js";
import { readScheduleTargetAgent } from "./automations-schedule-target.js";

const INBOX_DIR = "schedule-runs/awaiting-approval";
export const APPROVAL_ARTIFACT_VERSION = 1;

export type ApprovalStatus =
	| "awaiting-approval"
	| "approved"
	| "rejected"
	| "deferred"
	| "completed";

/** One inbox artifact. Hub-side writers preserve every field they did not change. */
export interface ApprovalArtifact {
	readonly version: number;
	readonly requestId: string;
	readonly taskId: string;
	readonly runId: string;
	readonly claimToken: string;
	readonly slotKey?: string;
	readonly status: ApprovalStatus;
	readonly prompt: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly decision?: string;
}

/** The hub shows only artifacts that still wait for a decision. */
export type PendingApprovalStatus = "awaiting-approval" | "deferred";

export interface PendingApproval {
	readonly requestId: string;
	readonly taskId: string;
	readonly runId: string;
	readonly prompt: string;
	readonly createdAt: string;
	readonly status: PendingApprovalStatus;
}

function approvalInboxRoot(config: AutomationsConfig): string {
	return join(config.automationsHome, INBOX_DIR);
}

export function approvalArtifactPath(config: AutomationsConfig, requestId: string): string {
	assertSafeId("approval request id", requestId);
	return join(approvalInboxRoot(config), `${requestId}.json`);
}

function isApprovalStatus(value: unknown): value is ApprovalStatus {
	return (
		value === "awaiting-approval" ||
		value === "approved" ||
		value === "rejected" ||
		value === "deferred" ||
		value === "completed"
	);
}

export function isPendingApproval(status: ApprovalStatus): status is PendingApprovalStatus {
	return status === "awaiting-approval" || status === "deferred";
}

export function isPrincipal(): boolean {
	return process.env.PI_PRINCIPAL === "1";
}

/** Strip control characters and redact credential-looking text before it is stored or shown. */
export function sanitizeApprovalText(value: string, maxChars: number): string {
	const withoutControls = [...value].map((character) => {
		const code = character.charCodeAt(0);
		return code < 0x20 || code === 0x7f ? " " : character;
	}).join("");
	return withoutControls
		.replace(/((?:api[_ -]?key|token|password|secret|credential)\s*[:=]\s*)\S+/gi, "$1[REDACTED]")
		.slice(0, maxChars);
}

function isSafeRunId(value: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes("..");
}

/** A run id is safe when it is a plain identifier segment (no traversal). */
export function isSafeApprovalRunId(runId: string): boolean {
	return isSafeRunId(runId);
}

/** Parse one stored artifact, rejecting anything the writer would not have produced. */
function parseApprovalArtifact(value: unknown, requestId: string): ApprovalArtifact | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const item = value as Record<string, unknown>;
	if (
		item.version !== APPROVAL_ARTIFACT_VERSION ||
		item.requestId !== requestId ||
		typeof item.taskId !== "string" ||
		typeof item.runId !== "string" ||
		typeof item.claimToken !== "string" ||
		item.claimToken.length < 16 ||
		(item.slotKey !== undefined && typeof item.slotKey !== "string") ||
		!isApprovalStatus(item.status) ||
		typeof item.prompt !== "string" ||
		typeof item.createdAt !== "string" ||
		typeof item.updatedAt !== "string"
	) {
		return undefined;
	}
	try {
		assertSafeId("task id", item.taskId);
		if (!isSafeApprovalRunId(item.runId)) throw new Error("unsafe run id");
	} catch {
		return undefined;
	}
	return {
		version: APPROVAL_ARTIFACT_VERSION,
		requestId,
		taskId: item.taskId,
		runId: item.runId,
		claimToken: item.claimToken,
		slotKey: typeof item.slotKey === "string" ? item.slotKey : undefined,
		status: item.status,
		prompt: sanitizeApprovalText(item.prompt, 4_000),
		createdAt: item.createdAt,
		updatedAt: item.updatedAt,
		decision: typeof item.decision === "string" ? sanitizeApprovalText(item.decision, 500) : undefined,
	};
}

/** Open the inbox root, refusing a symlinked Automations home. */
async function openInbox(config: AutomationsConfig): Promise<ConfinedStore | undefined> {
	return withAutomationsWording(async () => {
		await assertRootNotSymlink(config.automationsHome);
		return ConfinedStore.openRoot(config.automationsHome);
	});
}

async function createInbox(config: AutomationsConfig): Promise<ConfinedStore> {
	return withAutomationsWording(async () => {
		await assertRootNotSymlink(config.automationsHome);
		return ConfinedStore.createRoot(config.automationsHome);
	});
}

/**
 * Keep Automations' confinement wording for this store too: the extension names
 * the boundary it is enforcing, and operators grep for those messages.
 */
async function withAutomationsWording<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		throw new Error(
			error.message
				.replace("Refusing symlinked root", "Refusing symlinked Automations root")
				.replace("Refusing symlinked directory entry", "Refusing symlinked Automations directory entry"),
		);
	}
}

export async function readApprovalArtifact(
	config: AutomationsConfig,
	requestId: string,
): Promise<ApprovalArtifact | undefined> {
	const store = await openInbox(config);
	if (!store) return undefined;
	const raw = await store.readOptionalFile(approvalArtifactPath(config, requestId));
	if (raw === undefined) return undefined;
	try {
		return parseApprovalArtifact(JSON.parse(raw) as unknown, requestId);
	} catch {
		return undefined;
	}
}

export async function writeApprovalArtifact(config: AutomationsConfig, artifact: ApprovalArtifact): Promise<void> {
	const store = await createInbox(config);
	await store.writePrivateFileAtomic(
		approvalArtifactPath(config, artifact.requestId),
		`${JSON.stringify(artifact, null, 2)}\n`,
	);
}

/** Remove the given artifacts; missing files are ignored. */
export async function removeApprovalArtifacts(
	config: AutomationsConfig,
	requestIds: readonly string[],
): Promise<void> {
	if (requestIds.length === 0) return;
	const store = await openInbox(config);
	if (!store) return;
	await store.removePrivateFiles(requestIds.map((requestId) => approvalArtifactPath(config, requestId)));
}

/** Every artifact currently on disk, oldest update first. No retention policy. */
export async function readApprovalArtifacts(config: AutomationsConfig): Promise<ApprovalArtifact[]> {
	const store = await openInbox(config);
	const root = approvalInboxRoot(config);
	if (!store || !await store.fileExists(root)) return [];
	const artifacts: ApprovalArtifact[] = [];
	for (const entry of await withAutomationsWording(() => store.readDirectory(root))) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
		const artifact = await readApprovalArtifact(config, entry.name.slice(0, -5));
		if (artifact) artifacts.push(artifact);
	}
	return artifacts.sort((first, second) => first.updatedAt.localeCompare(second.updatedAt));
}

// ── Agent Hub view ──────────────────────────────────────────────

export interface AgentIdentity {
	readonly id: string;
	readonly name: string;
	readonly spawn_name?: string;
}

/** Pending approvals addressed to this agent (by schedule target, else by registry id). */
export async function listAgentApprovals(
	config: AutomationsConfig,
	record: AgentIdentity,
	selfId: string,
): Promise<PendingApproval[]> {
	const pending: PendingApproval[] = [];
	for (const artifact of await readApprovalArtifacts(config)) {
		if (!isPendingApproval(artifact.status)) continue;
		const targetAgent = await readScheduleTargetAgent(config, artifact.taskId);
		const matches = targetAgent
			? record.name === targetAgent || record.spawn_name === targetAgent
			: record.id === selfId;
		if (!matches) continue;
		pending.push({
			requestId: artifact.requestId,
			taskId: artifact.taskId,
			runId: artifact.runId,
			prompt: artifact.prompt,
			createdAt: artifact.createdAt,
			status: artifact.status,
		});
	}
	return pending;
}

type ApprovalDecisionStatus = "approved" | "rejected" | "deferred";

/**
 * Outcome of a decision attempt. `changed` is false when the artifact already
 * held that status or was frozen by a commitment, so a caller can report an
 * honest no-op instead of claiming a decision was recorded.
 */
export interface ApprovalDecision {
	readonly requestId: string;
	readonly status: ApprovalStatus;
	readonly changed: boolean;
}

async function decideAgentApproval(
	config: AutomationsConfig,
	requestId: string,
	status: ApprovalDecisionStatus,
): Promise<ApprovalDecision> {
	if (!isPrincipal()) throw new Error("Approval decisions require principal authority");
	return withAdvisoryLock(approvalArtifactPath(config, requestId), async () => {
		const current = await readApprovalArtifact(config, requestId);
		if (!current) throw new Error(`Unknown approval request: ${requestId}`);
		// Deferred stays decidable: it means "not now", and the row keeps its actions.
		// Completed and rejected are final, and an approval cannot be withdrawn after
		// the run may already have been resumed.
		if (
			current.status === "completed" ||
			current.status === "rejected" ||
			(current.status === "approved" && status !== "approved")
		) {
			return { requestId, status: current.status, changed: false };
		}
		if (current.status === status) return { requestId, status: current.status, changed: false };
		const next: ApprovalArtifact = { ...current, status, updatedAt: isoUtc() };
		await writeApprovalArtifact(config, next);
		return { requestId, status: next.status, changed: true };
	});
}

export async function approveAgentApproval(
	config: AutomationsConfig,
	requestId: string,
): Promise<ApprovalDecision> {
	return decideAgentApproval(config, requestId, "approved");
}

export async function rejectAgentApproval(
	config: AutomationsConfig,
	requestId: string,
): Promise<ApprovalDecision> {
	return decideAgentApproval(config, requestId, "rejected");
}

export async function deferAgentApproval(
	config: AutomationsConfig,
	requestId: string,
): Promise<ApprovalDecision> {
	return decideAgentApproval(config, requestId, "deferred");
}

export async function resumeAgentApproval(
	pi: ExtensionAPI,
	config: AutomationsConfig,
	requestId: string,
): Promise<boolean> {
	const approval = await readApprovalArtifact(config, requestId);
	if (!approval || approval.status !== "approved") return false;
	const state = await loadRunState(config, approval.taskId);
	if (
		!state ||
		state.status !== "awaiting-approval" ||
		state.runId !== approval.runId ||
		(state.requestId ?? requestId) !== requestId
	) {
		return false;
	}
	const runningState: ScheduleRunState = { ...state, status: "running", lastUpdatedAt: isoUtc() };
	await saveRunState(config, approval.taskId, runningState);
	try {
		pi.sendUserMessage(approval.prompt, { deliverAs: "followUp" });
		return true;
	} catch (error) {
		await saveRunState(config, approval.taskId, {
			...state,
			status: "interrupted",
			reason: `resume_failed: ${(error as Error).message}`,
			lastUpdatedAt: isoUtc(),
		});
		return false;
	}
}
