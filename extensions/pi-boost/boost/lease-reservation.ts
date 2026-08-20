/** Reservation operation for the inert ADR-045 lease authority. */

import { appendAudit } from "./audit.js";
import {
	isValidReserveIdentity,
	resolveBoostModels,
} from "./authority-policy.js";
import type {
	BoostLeaseDependencies,
	BoostLeaseOptions,
	BoostLeaseStatus,
	BoostResult,
	ReserveBoostInput,
} from "./contracts.js";
import type { BoostLeaseRecord } from "./lease-record.js";
import { snapshotWorkspace } from "./lease-record.js";
import { isValidBoostRequest } from "./parser.js";
import { leaseStatus } from "./reversion.js";

interface BoostLeaseReservationState {
	getLease(): BoostLeaseRecord | undefined;
	setLease(lease: BoostLeaseRecord | undefined): void;
	nextId(kind: "lease" | "subject" | "issuer"): string;
}

interface ReserveBoostLeaseInput {
	readonly dependencies: BoostLeaseDependencies;
	readonly options: BoostLeaseOptions;
	readonly owner: symbol;
	readonly state: BoostLeaseReservationState;
	readonly request: ReserveBoostInput;
}

export function reserveBoostLease(
	input: ReserveBoostLeaseInput,
): BoostResult<BoostLeaseStatus> {
	const { dependencies, options, owner, state, request } = input;
	if (
		request.actor.kind !== "principal" ||
		request.actor.issuerId.length === 0
	) {
		return { ok: false, reason: "unauthorized" };
	}
	const existing = state.getLease();
	if (
		existing ||
		!isValidReserveIdentity(request) ||
		!isValidBoostRequest(request.request)
	) {
		return {
			ok: false,
			reason: existing ? "slot-occupied" : "invalid-request",
		};
	}
	const models = resolveBoostModels(dependencies);
	if (!models) {
		return { ok: false, reason: "model-policy-invalid" };
	}
	if (!dependencies.slot.tryAcquire(owner)) {
		return { ok: false, reason: "slot-occupied" };
	}
	const lease: BoostLeaseRecord = {
		leaseId: state.nextId("lease"),
		opaqueSubjectId: state.nextId("subject"),
		opaqueIssuerId: state.nextId("issuer"),
		subjectId: request.subject.subjectId,
		issuerId: request.actor.issuerId,
		workspace: snapshotWorkspace(request.subject.workspace),
		isolation: request.request.isolation,
		requestedYields: request.request.requestedYields,
		pendingCombinedInput: request.request.combinedInput,
		capturedBaseline: models.baseline,
		leaseModel: models.lease,
		expiresAt: dependencies.now() + options.leaseDurationMs,
		state: "Reserved",
		consumedYields: 0,
		activationCount: 0,
	};
	state.setLease(lease);
	if (
		!appendAudit(dependencies, lease, {
			phase: "transition",
			fromState: "Idle",
			toState: "Reserved",
		})
	) {
		dependencies.slot.release(owner);
		state.setLease(undefined);
		return { ok: false, reason: "audit-write-failed" };
	}
	return { ok: true, value: leaseStatus(lease) };
}
