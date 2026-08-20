/** Activation transition for the inert ADR-045 lease authority. */

import { appendAudit } from "./audit.js";
import {
	buildActivationInput,
	classifyBoostInput,
	revalidateBoostWorkspace,
} from "./authority-policy.js";
import type {
	ActivateBoostInput,
	BoostActivationGrant,
	BoostDenialReason,
	BoostFailureCategory,
	BoostLeaseDependencies,
	BoostResult,
} from "./contracts.js";
import type { BoostLeaseRecord } from "./lease-record.js";

interface BoostActivationOperations {
	deny(
		lease: BoostLeaseRecord,
		reason: BoostDenialReason,
		category: BoostFailureCategory,
	): BoostResult<BoostActivationGrant>;
	revertAndDeny(
		lease: BoostLeaseRecord,
		reason: BoostDenialReason,
		category: BoostFailureCategory,
	): BoostResult<BoostActivationGrant>;
}

export function activateReservedBoostLease(
	dependencies: BoostLeaseDependencies,
	lease: BoostLeaseRecord,
	input: ActivateBoostInput,
	operations: BoostActivationOperations,
): BoostResult<BoostActivationGrant> {
	const combinedInput = buildActivationInput(lease, input.prompt);
	lease.pendingCombinedInput = undefined;
	if (!combinedInput) {
		return operations.deny(lease, "invalid-request", "invalid-request");
	}
	const governance = classifyBoostInput(dependencies, combinedInput);
	if (governance !== undefined) {
		return operations.revertAndDeny(lease, governance, governance);
	}
	if (!revalidateBoostWorkspace(dependencies, lease)) {
		return operations.revertAndDeny(
			lease,
			"workspace-mismatch",
			"workspace-mismatch",
		);
	}
	if (
		!appendAudit(dependencies, lease, {
			phase: "before-activation",
			fromState: "Reserved",
			toState: "Active",
		})
	) {
		return { ok: false, reason: "audit-write-failed" };
	}
	try {
		lease.activeContext = dependencies.isolation.create({
			mode: lease.isolation,
			issuerId: lease.issuerId,
			subjectId: lease.subjectId,
			workspace: lease.workspace,
			combinedInput,
			includeConversationHistory: lease.isolation === "current",
			includeHiddenSessionState: lease.isolation === "current",
			mergeBack: false,
			mayCreateLease: false,
			policyScope:
				lease.isolation === "current" ? "session" : "immutable-and-repository",
		});
	} catch {
		return operations.revertAndDeny(
			lease,
			"isolation-failed",
			"isolation-failed",
		);
	}
	lease.state = "Active";
	try {
		dependencies.models.select(lease.subjectId, lease.leaseModel);
	} catch {
		return operations.revertAndDeny(
			lease,
			"model-selection-failed",
			"model-selection-failed",
		);
	}
	lease.activationCount += 1;
	lease.activeActivationId = lease.activationCount;
	if (
		!appendAudit(dependencies, lease, {
			phase: "transition",
			fromState: "Reserved",
			toState: "Active",
		})
	) {
		return operations.revertAndDeny(
			lease,
			"audit-write-failed",
			"audit-write-failed",
		);
	}
	return {
		ok: true,
		value: {
			leaseId: lease.leaseId,
			activationId: lease.activeActivationId,
			model: lease.leaseModel,
			context: lease.activeContext,
		},
	};
}
