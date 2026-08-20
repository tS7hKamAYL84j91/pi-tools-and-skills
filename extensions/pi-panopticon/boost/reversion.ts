/** Idempotent baseline restoration and cleanup for ADR-045 lease transitions. */

import { appendAudit } from "./audit.js";
import type {
	BoostFailureCategory,
	BoostLeaseDependencies,
	BoostLeaseState,
	BoostLeaseStatus,
	BoostResult,
} from "./contracts.js";
import type { BoostLeaseRecord } from "./lease-record.js";

interface RevertLeaseInput {
	readonly dependencies: BoostLeaseDependencies;
	readonly lease: BoostLeaseRecord;
	readonly owner: symbol;
	readonly targetState: "Reserved" | "Idle";
	readonly category?: BoostFailureCategory;
	readonly forceFailure?: BoostFailureCategory;
}

export function revertLease(
	input: RevertLeaseInput,
): BoostResult<BoostLeaseStatus> {
	const { dependencies, lease } = input;
	const fromState = lease.state;
	lease.state = "Reverting";
	lease.activeActivationId = undefined;
	let failureCategory: BoostFailureCategory | undefined;
	if (
		!appendAudit(
			dependencies,
			lease,
			transition(fromState, "Reverting", input.category),
		)
	) {
		failureCategory = "audit-write-failed";
	}
	try {
		dependencies.models.restore(lease.subjectId, lease.capturedBaseline);
	} catch {
		failureCategory ??= "restore-failed";
	}
	if (lease.activeContext) {
		try {
			dependencies.isolation.dispose(lease.activeContext);
			lease.activeContext = undefined;
		} catch {
			failureCategory ??= "context-disposal-failed";
		}
	}
	if (failureCategory) {
		return enterRevertFailed(dependencies, lease, failureCategory);
	}
	if (input.forceFailure) {
		return enterRevertFailed(dependencies, lease, input.forceFailure);
	}
	lease.state = input.targetState;
	if (
		!appendAudit(
			dependencies,
			lease,
			transition("Reverting", input.targetState, input.category),
		)
	) {
		return enterRevertFailed(dependencies, lease, "audit-write-failed");
	}
	if (input.targetState === "Idle" && !dependencies.slot.release(input.owner)) {
		return enterRevertFailed(dependencies, lease, "cleanup-failed");
	}
	lease.failureCategory = undefined;
	return { ok: true, value: leaseStatus(lease) };
}

export function leaseStatus(lease: BoostLeaseRecord): BoostLeaseStatus {
	return {
		state: lease.state,
		leaseId: lease.leaseId,
		requestedYields: lease.requestedYields,
		consumedYields: lease.consumedYields,
		remainingYields: Math.max(0, lease.requestedYields - lease.consumedYields),
		expiresAt: lease.expiresAt,
		...(lease.failureCategory
			? { failureCategory: lease.failureCategory }
			: {}),
	};
}

function enterRevertFailed(
	dependencies: BoostLeaseDependencies,
	lease: BoostLeaseRecord,
	category: BoostFailureCategory,
): BoostResult<BoostLeaseStatus> {
	lease.state = "RevertFailed";
	lease.failureCategory = category;
	appendAudit(
		dependencies,
		lease,
		transition("Reverting", "RevertFailed", category),
	);
	return { ok: false, reason: "revert-failed" };
}

function transition(
	fromState: BoostLeaseState,
	toState: BoostLeaseState,
	failureCategory?: BoostFailureCategory,
) {
	return {
		phase: "transition" as const,
		fromState,
		toState,
		...(failureCategory ? { failureCategory } : {}),
	};
}
