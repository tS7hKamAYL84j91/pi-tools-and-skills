/** Redacted audit-record construction for the inert boost lease domain. */

import type {
	BoostAuditPhase,
	BoostFailureCategory,
	BoostLeaseDependencies,
	BoostLeaseState,
} from "./contracts.js";
import { BOOST_MODEL_POLICY_KEYS } from "./contracts.js";
import type { BoostLeaseRecord } from "./lease-record.js";

interface AuditTransition {
	readonly phase: BoostAuditPhase;
	readonly fromState: BoostLeaseState;
	readonly toState: BoostLeaseState;
	readonly failureCategory?: BoostFailureCategory;
}

export function appendAudit(
	dependencies: BoostLeaseDependencies,
	lease: BoostLeaseRecord,
	transition: AuditTransition,
): boolean {
	try {
		dependencies.audit.append({
			timestamp: dependencies.now(),
			phase: transition.phase,
			leaseId: lease.leaseId,
			subjectId: lease.opaqueSubjectId,
			issuerId: lease.opaqueIssuerId,
			fromState: transition.fromState,
			toState: transition.toState,
			requestedYields: lease.requestedYields,
			consumedYields: lease.consumedYields,
			isolation: lease.isolation,
			policyKeys: BOOST_MODEL_POLICY_KEYS,
			...(transition.failureCategory
				? { failureCategory: transition.failureCategory }
				: {}),
		});
		return true;
	} catch {
		// Audit failures are converted to bounded domain decisions.
		return false;
	}
}
