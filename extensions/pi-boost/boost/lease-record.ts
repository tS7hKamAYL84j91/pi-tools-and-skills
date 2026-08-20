/** Internal in-memory state for the inert ADR-045 lease domain. */

import type {
	BoostFailureCategory,
	BoostIsolationMode,
	BoostLeaseState,
	BoostModelIdentity,
	BoostTransientContext,
	BoostWorkspaceIdentity,
} from "./contracts.js";

export interface BoostLeaseRecord {
	readonly leaseId: string;
	readonly opaqueSubjectId: string;
	readonly opaqueIssuerId: string;
	readonly subjectId: string;
	readonly issuerId: string;
	readonly workspace: BoostWorkspaceIdentity;
	readonly isolation: BoostIsolationMode;
	readonly requestedYields: number;
	/** One-time pending dispatch payload; cleared before activating. */
	pendingCombinedInput?: string;
	readonly capturedBaseline: BoostModelIdentity;
	readonly leaseModel: BoostModelIdentity;
	readonly expiresAt: number;
	state: BoostLeaseState;
	consumedYields: number;
	activationCount: number;
	activeActivationId?: number;
	activeContext?: BoostTransientContext;
	failureCategory?: BoostFailureCategory;
}

export function snapshotWorkspace(
	workspace: BoostWorkspaceIdentity,
): BoostWorkspaceIdentity {
	return Object.freeze({
		workspaceId: workspace.workspaceId,
		root: workspace.root,
	});
}
