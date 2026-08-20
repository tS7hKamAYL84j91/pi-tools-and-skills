/** Shared state transitions for the inert ADR-045 lease authority. */

import { appendAudit } from "./audit.js";
import type {
	BoostDenialReason,
	BoostFailureCategory,
	BoostLeaseDependencies,
	BoostLeaseStatus,
	BoostResult,
} from "./contracts.js";
import type { BoostLeaseRecord } from "./lease-record.js";
import { revertLease } from "./reversion.js";

interface DenyBoostLeaseInput {
	readonly dependencies: BoostLeaseDependencies;
	readonly lease: BoostLeaseRecord;
	readonly reason: BoostDenialReason;
	readonly category: BoostFailureCategory;
}

export function denyBoostLease<T>(input: DenyBoostLeaseInput): BoostResult<T> {
	const { dependencies, lease, reason, category } = input;
	const audited = appendAudit(dependencies, lease, {
		phase: "denial",
		fromState: lease.state,
		toState: lease.state,
		failureCategory: category,
	});
	return { ok: false, reason: audited ? reason : "audit-write-failed" };
}

interface RevertBoostLeaseInput {
	readonly dependencies: BoostLeaseDependencies;
	readonly owner: symbol;
	readonly lease: BoostLeaseRecord;
	readonly targetState: "Reserved" | "Idle";
	readonly category?: BoostFailureCategory;
	readonly forceFailure?: BoostFailureCategory;
}

export function revertBoostLease(
	input: RevertBoostLeaseInput,
): BoostResult<BoostLeaseStatus> {
	return revertLease({
		dependencies: input.dependencies,
		lease: input.lease,
		owner: input.owner,
		targetState: input.targetState,
		...(input.category ? { category: input.category } : {}),
		...(input.forceFailure ? { forceFailure: input.forceFailure } : {}),
	});
}
