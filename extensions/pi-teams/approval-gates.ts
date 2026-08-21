/** Provisional approval gate primitives for pi-teams workflows. */

import type { TeamStateManager } from "./state.js";

/** @public */
export const TEAM_APPROVAL_SCHEMA_VERSION = 1;

/** @public */
export type TeamApprovalRisk = "medium" | "high" | "critical";
/** @public */
export type TeamApprovalStatus = "proposed" | "awaiting_approval" | "approved" | "rejected" | "expired" | "stopped";

/** @public */
export interface TeamApprovalRequest {
	schemaVersion: typeof TEAM_APPROVAL_SCHEMA_VERSION;
	gateId: string;
	runId: string;
	teamId: string;
	phaseId?: string;
	nodeId?: string;
	action: string;
	risk: TeamApprovalRisk;
	owner: string;
	source: "human" | "orchestrator" | "policy";
	reason: string;
	expiresAt?: number;
	artifactUri?: string;
}

/** @public */
export interface TeamApprovalResult {
	schemaVersion: typeof TEAM_APPROVAL_SCHEMA_VERSION;
	gateId: string;
	runId: string;
	status: "approved" | "rejected" | "expired";
	decidedBy: string;
	decidedAt: number;
	reason?: string;
}

/** @public */
export interface TeamApprovalGateState {
	request: TeamApprovalRequest;
	status: TeamApprovalStatus;
	result?: TeamApprovalResult;
}

function validateRequest(request: TeamApprovalRequest): void {
	if (request.schemaVersion !== TEAM_APPROVAL_SCHEMA_VERSION) throw new Error("unsupported approval request schemaVersion");
	if (!request.gateId || !request.runId || !request.teamId || !request.action || !request.owner || !request.reason) throw new Error("approval request missing required fields");
	if (request.expiresAt !== undefined && !Number.isFinite(request.expiresAt)) throw new Error("approval request expiresAt must be finite");
}

function validateResult(request: TeamApprovalRequest, result: TeamApprovalResult): void {
	if (result.schemaVersion !== TEAM_APPROVAL_SCHEMA_VERSION) throw new Error("unsupported approval result schemaVersion");
	if (result.gateId !== request.gateId || result.runId !== request.runId) throw new Error("approval result does not match request");
	if (!result.decidedBy || !Number.isFinite(result.decidedAt)) throw new Error("approval result missing decision metadata");
}

/** Create an awaiting approval state and emit an auditable trace detail. */
export function requestTeamApproval(stateManager: TeamStateManager, request: TeamApprovalRequest): TeamApprovalGateState {
	validateRequest(request);
	stateManager.recordDetail(request.runId, {
		kind: "trace",
		message: `approval required: ${request.action}`,
		...(request.phaseId ? { phaseId: request.phaseId } : {}),
		...(request.nodeId ? { nodeId: request.nodeId } : {}),
		...(request.artifactUri ? { artifactUri: request.artifactUri } : {}),
		data: { approval: "required", gateId: request.gateId, risk: request.risk, owner: request.owner, source: request.source, reason: request.reason, ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}) },
	});
	return { request, status: "awaiting_approval" };
}

/** Resolve an approval gate and emit a structured approval result detail. */
export function resolveTeamApproval(stateManager: TeamStateManager, gate: TeamApprovalGateState, result: TeamApprovalResult): TeamApprovalGateState {
	validateResult(gate.request, result);
	const status = result.status;
	stateManager.recordDetail(gate.request.runId, {
		kind: "trace",
		message: `approval ${status}: ${gate.request.action}`,
		...(gate.request.phaseId ? { phaseId: gate.request.phaseId } : {}),
		...(gate.request.nodeId ? { nodeId: gate.request.nodeId } : {}),
		data: { approval: status, gateId: gate.request.gateId, decidedBy: result.decidedBy, reason: result.reason ?? "" },
	});
	return { ...gate, status, result };
}

function canProceedAfterApproval(gate: TeamApprovalGateState, now = Date.now()): boolean {
	if (gate.request.expiresAt !== undefined && now > gate.request.expiresAt) return false;
	return gate.status === "approved" && gate.result?.status === "approved";
}

/** Execute an action only after approval; rejection/expiry records stopped state. */
export async function executeAfterApproval<T>(stateManager: TeamStateManager, gate: TeamApprovalGateState, action: () => Promise<T>, now = Date.now()): Promise<T | undefined> {
	if (canProceedAfterApproval(gate, now)) return action();
	const reason = gate.status === "awaiting_approval" ? "approval required" : `approval ${gate.status}`;
	stateManager.recordRunStopped(gate.request.runId, 0, reason);
	return undefined;
}
