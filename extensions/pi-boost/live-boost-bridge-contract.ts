/** Host-only live boost capability contracts. */

import type {
	BoostActor,
	BoostGovernanceDecision,
	BoostIsolationMode,
	BoostRequest,
	BoostSubject,
	BoostTerminalOutcome,
} from "./boost/contracts.js";
import type { DaemonBoostControlStore } from "./daemon-boost-control-store.js";
import type {
	LiveBoostControlAdapter,
	LiveBoostControlReference,
} from "./live-boost-control-contract.js";
import type { BoostDescriptorAdapter } from "./boost-descriptor-adapter.js";
import type {
	BoostThinkingLevel,
	ReviewedBoostModel,
	ReviewedBoostModelResolver,
	ReviewedBoostThinkingPolicyResolver,
} from "./boost-descriptor.js";

export type LiveBoostDenialReason =
	| "unauthorized"
	| "control-invalid"
	| "control-unavailable"
	| "governance-denied"
	| "budget-denied"
	| "lease-not-found"
	| "revert-failed"
	| "stale-activation"
	| "provider-failed"
	| "revoked"
	| "expired"
	| "rollback"
	| "revision"
	| "shutdown";

export type LiveBoostResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: LiveBoostDenialReason };

export interface LiveBoostReserveInput {
	readonly caller: BoostActor;
	readonly subject: BoostSubject;
	readonly request: BoostRequest;
	readonly control: LiveBoostControlReference;
}

export interface LiveBoostDispatchInput {
	readonly caller: BoostActor;
	readonly subjectId: string;
	readonly leaseId: string;
	readonly control: LiveBoostControlReference;
	readonly combinedInput: string;
	readonly isolation: BoostIsolationMode;
}

export interface LiveBoostResetInput {
	readonly caller: BoostActor;
	readonly subjectId: string;
	readonly control: LiveBoostControlReference;
}

export interface LiveBoostLeaseStatus {
	readonly state: "Reserved";
	readonly leaseId: string;
	readonly requestedYields: number;
	readonly consumedYields: number;
	readonly remainingYields: number;
	readonly expiresAt: number;
}

export interface LiveBoostProviderRequest {
	readonly enablementId: string;
	readonly model: ReviewedBoostModel;
	readonly thinkingLevel: BoostThinkingLevel;
	readonly subjectId: string;
	readonly leaseId: string;
	readonly activationGeneration: number;
	readonly combinedInput: string;
	readonly isolation: BoostIsolationMode;
}

export interface LiveBoostTerminalEvent {
	readonly leaseId: string;
	readonly activationGeneration: number;
	readonly outcome: BoostTerminalOutcome;
	readonly humanVisible: boolean;
}

export interface LiveBoostAuditRecord {
	readonly timestamp: number;
	readonly phase: "terminal" | "revoked" | "revert-failed" | "reset";
	readonly enablementId: string;
	readonly subjectId: string;
	readonly leaseId: string;
	readonly activationGeneration?: number;
	readonly outcome?: BoostTerminalOutcome;
	readonly failureCategory?:
		| "restore-failed"
		| "audit-failed"
		| "cleanup-failed"
		| "shutdown-recovery";
}

export interface LiveBoostRuntimeDependencies {
	readonly store: DaemonBoostControlStore;
	readonly control: LiveBoostControlAdapter;
	readonly descriptor: BoostDescriptorAdapter;
	readonly models: ReviewedBoostModelResolver;
	readonly thinkingPolicy: ReviewedBoostThinkingPolicyResolver;
	readonly now: () => number;
	readonly nextLeaseId: () => string;
	readonly governance: {
		classify(combinedInput: string): Promise<BoostGovernanceDecision>;
	};
	readonly provider: {
		dispatch(
			request: LiveBoostProviderRequest,
			signal: AbortSignal,
		): Promise<LiveBoostTerminalEvent>;
	};
	readonly baseline: {
		restore(subjectId: string): Promise<void>;
	};
	readonly isolation: {
		dispose(subjectId: string): Promise<void>;
	};
	readonly audit: {
		append(record: LiveBoostAuditRecord): Promise<void>;
	};
}

export interface LiveBoostRuntimeBridge {
	reserve(
		input: LiveBoostReserveInput,
	): Promise<LiveBoostResult<LiveBoostLeaseStatus>>;
	dispatch(
		input: LiveBoostDispatchInput,
	): Promise<LiveBoostResult<LiveBoostTerminalEvent>>;
	reset(
		input: LiveBoostResetInput,
	): Promise<LiveBoostResult<{ readonly reset: true }>>;
	getStatus(input: {
		readonly caller: BoostActor;
		readonly subjectId: string;
	}): Promise<
		LiveBoostResult<
			LiveBoostLeaseStatus | { readonly state: "Idle" | "RevertFailed" }
		>
	>;
	checkDispatch(
		subjectId: string,
	):
		| { readonly allowed: true }
		| { readonly allowed: false; readonly reason: "revert-failed" };
	shutdown(input: {
		readonly choice: "synchronous-restore" | "durable-block-marker";
	}): Promise<void>;
}
