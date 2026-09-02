/** Boost lease state machine: single global lease, 3-yield cap, 10-minute TTL (T-854). */

import { BOOST_LEASE_TTL_MS } from "./boost-settings.js";

/** Minimal model shape used for boost switching (avoids pi's internal Model type). */
export interface BoostCandidateModel {
	readonly provider: string;
	readonly id: string;
	readonly input: readonly string[];
}

export interface BoostLeaseState {
	yieldsUsed: number;
	/** Original model to restore when the boost run settles. */
	originalModel: BoostCandidateModel | undefined;
	/** Sticky failure: baseline restore failed; dispatch blocked until reset retries it. */
	revertFailed: boolean;
	/** Wall-clock start (first successful yield); leases expire after BOOST_LEASE_TTL_MS (T-854). */
	startedAtMs: number | undefined;
}

export function createLeaseState(): BoostLeaseState {
	return {
		yieldsUsed: 0,
		originalModel: undefined,
		revertFailed: false,
		startedAtMs: undefined,
	};
}

/** A started lease older than the TTL is expired; dispatch denies until reset (T-854). */
export function leaseExpired(lease: BoostLeaseState, nowMs: number): boolean {
	return (
		lease.yieldsUsed > 0 &&
		lease.startedAtMs !== undefined &&
		nowMs - lease.startedAtMs >= BOOST_LEASE_TTL_MS
	);
}

/** Canonical lease state, highest priority first: blocked > expired > active > off. */
export function leaseState(lease: BoostLeaseState, nowMs: number): string {
	if (lease.revertFailed) return "blocked";
	if (leaseExpired(lease, nowMs)) return "expired";
	if (lease.originalModel) return "active";
	return "off";
}

/** Powerline labels (ADR-057 UX contract: state + remaining yields only). */
export const POWERLINE_LABELS: Record<string, string> = {
	blocked: "blocked · restore failed",
	expired: "expired",
	active: "active",
	off: "off",
};

/** /boost status labels. */
export const STATUS_LABELS: Record<string, string> = {
	blocked: "blocked (restore failed)",
	expired: "expired (reset to renew)",
	active: "active",
	off: "off",
};
