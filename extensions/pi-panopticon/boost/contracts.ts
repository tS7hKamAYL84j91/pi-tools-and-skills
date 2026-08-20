/** Inert contracts for the ADR-045 mock-only boost lease domain. */

export const BOOST_MODEL_POLICY_KEYS = [
	"principalBoostBaseline",
	"principalBoostLease",
] as const;

export type BoostModelPolicyKey = (typeof BOOST_MODEL_POLICY_KEYS)[number];
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
export type BoostTerminationReason = "expiry" | "restart" | "session-transfer";
export type BoostAuditPhase = "before-activation" | "transition" | "denial";
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
	| "budget-exhausted";

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

export interface BoostModelIdentity {
	readonly provider: string;
	readonly id: string;
	readonly family: string;
	readonly registered: boolean;
}

export interface IsolationContextRequest {
	readonly mode: BoostIsolationMode;
	readonly issuerId: string;
	readonly subjectId: string;
	readonly workspace: BoostWorkspaceIdentity;
	readonly combinedInput: string;
	readonly includeConversationHistory: boolean;
	readonly includeHiddenSessionState: boolean;
	readonly mergeBack: false;
	readonly mayCreateLease: false;
	readonly policyScope: "session" | "immutable-and-repository";
}

export interface BoostTransientContext {
	readonly contextId: string;
	readonly mode: BoostIsolationMode;
	readonly issuerId: string;
	readonly subjectId: string;
	readonly workspace: BoostWorkspaceIdentity;
	readonly combinedInput: string;
	readonly inheritsConversationHistory: boolean;
	readonly inheritsHiddenSessionState: boolean;
	readonly mergeBack: false;
	readonly transientSessionId?: string;
}

export interface BoostAuditRecord {
	readonly timestamp: number;
	readonly phase: BoostAuditPhase;
	readonly leaseId: string;
	readonly subjectId: string;
	readonly issuerId: string;
	readonly fromState: BoostLeaseState;
	readonly toState: BoostLeaseState;
	readonly requestedYields: number;
	readonly consumedYields: number;
	readonly isolation: BoostIsolationMode;
	readonly policyKeys: readonly BoostModelPolicyKey[];
	readonly failureCategory?: BoostFailureCategory;
}

export interface BoostAuditSink {
	append(record: BoostAuditRecord): void;
}

export interface BoostGovernanceClassifier {
	classify(combinedInput: string): BoostGovernanceDecision;
}

export interface BoostModelAdapter {
	resolve(key: BoostModelPolicyKey): BoostModelIdentity | undefined;
	select(subjectId: string, model: BoostModelIdentity): void;
	restore(subjectId: string, capturedBaseline: BoostModelIdentity): void;
}

export interface BoostIsolationAdapter {
	create(request: IsolationContextRequest): BoostTransientContext;
	dispose(context: BoostTransientContext): void;
}

export interface BoostWorkspaceValidator {
	revalidate(
		subjectId: string,
		capturedWorkspace: BoostWorkspaceIdentity,
	): boolean;
}

export interface BoostIdSource {
	next(kind: "lease" | "subject" | "issuer"): string;
}

export interface BoostGlobalSlot {
	tryAcquire(owner: symbol): boolean;
	isOwnedBy(owner: symbol): boolean;
	release(owner: symbol): boolean;
	isOccupied(): boolean;
}

export interface BoostLeaseDependencies {
	readonly audit: BoostAuditSink;
	readonly governance: BoostGovernanceClassifier;
	readonly ids: BoostIdSource;
	readonly isolation: BoostIsolationAdapter;
	readonly models: BoostModelAdapter;
	readonly now: () => number;
	readonly slot: BoostGlobalSlot;
	readonly workspace: BoostWorkspaceValidator;
}

export interface BoostLeaseOptions {
	readonly leaseDurationMs: number;
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

export interface BoostActivationGrant {
	readonly leaseId: string;
	/** Monotonic activation generation; terminal callbacks must echo it. */
	readonly activationId: number;
	readonly model: BoostModelIdentity;
	readonly context: BoostTransientContext;
}

export interface BoostDispatchDecision {
	readonly allowed: boolean;
	readonly reason?: "revert-failed";
}

export type BoostResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: BoostDenialReason };

export interface ReserveBoostInput {
	readonly actor: BoostActor;
	readonly subject: BoostSubject;
	readonly request: BoostRequest;
}

export interface ActivateBoostInput {
	readonly actor: BoostActor;
	readonly leaseId: string;
	readonly prompt?: string;
}

export interface SettleBoostInput {
	readonly leaseId: string;
	readonly activationId: number;
	readonly outcome: BoostTerminalOutcome;
}

export interface TerminateBoostInput {
	readonly leaseId: string;
	readonly reason: Exclude<BoostTerminationReason, "expiry">;
}

export interface ResetBoostInput {
	readonly actor: BoostActor;
	readonly subjectId: string;
}
