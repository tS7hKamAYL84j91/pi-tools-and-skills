/** Shared boost contracts: actors, requests, lease status, and command results. */

export type BoostIsolationMode = "current" | "clean" | "fresh";
export type BoostLeaseState =
	| "Idle"
	| "Reserved"
	| "Active"
	| "Reverting"
	| "RevertFailed";
export type BoostActorKind =
	| "principal"
	| "agent"
	| "schedule"
	| "matrix"
	| "tool"
	| "child";
export type BoostGovernanceDecision =
	| "public"
	| "private"
	| "local-only"
	| "denied";
export type BoostTerminalOutcome =
	| "visible"
	| "collapsed-visible"
	| "cancelled"
	| "failed"
	| "tool-only"
	| "suppressed";
export type BoostFailureCategory =
	| "authorization-denied"
	| "issuer-mismatch"
	| "slot-occupied"
	| "invalid-request"
	| "model-policy-invalid"
	| "governance-private"
	| "governance-denied"
	| "workspace-mismatch"
	| "audit-write-failed"
	| "model-selection-failed"
	| "isolation-failed"
	| "restore-failed"
	| "context-disposal-failed"
	| "cleanup-failed"
	| "expired"
	| "restart"
	| "session-transfer";
export type BoostDenialReason =
	| "unauthorized"
	| "issuer-mismatch"
	| "slot-occupied"
	| "invalid-request"
	| "model-policy-invalid"
	| "governance-private"
	| "governance-denied"
	| "workspace-mismatch"
	| "audit-write-failed"
	| "model-selection-failed"
	| "isolation-failed"
	| "revert-failed"
	| "lease-not-found"
	| "lease-not-active"
	| "budget-exhausted"
	| "runtime-unavailable";

export interface BoostActor {
	readonly kind: BoostActorKind;
	readonly issuerId: string;
}

export interface BoostWorkspaceIdentity {
	readonly workspaceId: string;
	readonly root: string;
}

export interface BoostSubject {
	readonly subjectId: string;
	readonly workspace: BoostWorkspaceIdentity;
}

export interface BoostRequest {
	readonly requestedYields: number;
	readonly isolation: BoostIsolationMode;
	readonly prompt: string;
	readonly combinedInput: string;
}

export interface BoostLeaseStatus {
	readonly state: BoostLeaseState;
	readonly leaseId?: string;
	readonly requestedYields?: number;
	readonly consumedYields?: number;
	readonly remainingYields?: number;
	readonly expiresAt?: number;
	readonly failureCategory?: BoostFailureCategory;
}

export type BoostResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: BoostDenialReason };

export interface ReserveBoostInput {
	readonly actor: BoostActor;
	readonly subject: BoostSubject;
	readonly request: BoostRequest;
}

export interface ResetBoostInput {
	readonly actor: BoostActor;
	readonly subjectId: string;
}