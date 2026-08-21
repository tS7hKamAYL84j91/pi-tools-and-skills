/** Small pure helpers for the host-injected Boost runtime. */

import type { DaemonBoostLeaseSnapshot } from "./daemon-boost-control-store.js";
import type {
	LiveBoostControlReference,
} from "./live-boost-control-contract.js";
import {
	BOOST_LEASE_MODEL_KEY,
	type BoostDescriptorResolution,
	type ReviewedBoostModel,
	type ReviewedBoostModelResolver,
} from "./boost-descriptor.js";
import type {
	LiveBoostDenialReason,
	LiveBoostLeaseStatus,
} from "./live-boost-bridge-contract.js";

export function resolveSelectedModel(
	models: ReviewedBoostModelResolver,
	resolution: BoostDescriptorResolution | undefined,
): ReviewedBoostModel | undefined {
	if (!resolution) return undefined;
	try {
		const model = models.resolve(BOOST_LEASE_MODEL_KEY);
		return model && model.provider === resolution.descriptor.model.provider &&
			model.id === resolution.descriptor.model.id &&
			model.family === resolution.descriptor.model.family ? model : undefined;
	} catch {
		return undefined;
	}
}

export function isPrincipal(actor: { readonly kind: string; readonly issuerId: string }): boolean {
	return actor.kind === "principal" && actor.issuerId.length > 0;
}

export function sameControl(
	left: LiveBoostControlReference,
	right: LiveBoostControlReference,
): boolean {
	return left.enablementId === right.enablementId;
}

export function liveBoostStatus(lease: DaemonBoostLeaseSnapshot): LiveBoostLeaseStatus {
	return {
		state: "Reserved",
		leaseId: lease.leaseId,
		requestedYields: lease.requestedYields,
		consumedYields: lease.consumedYields,
		remainingYields: lease.requestedYields - lease.consumedYields,
		expiresAt: lease.expiresAt,
	};
}

export function mapLiveBoostStoreReason(reason: string): LiveBoostDenialReason {
	if (reason === "stale-activation") return "stale-activation";
	if (reason === "blocked-subject") return "revert-failed";
	return reason === "lease-not-found" ? "lease-not-found" : "budget-denied";
}
