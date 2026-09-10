/** Boost lease state machine: single global lease, 3-yield cap, configurable TTL. */

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
	/** Wall-clock start (first successful yield); leases expire after the configured duration. */
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

/** A started lease older than the TTL renews on the next idle human boost request. */
function leaseExpired(lease: BoostLeaseState, nowMs: number, ttlMs = BOOST_LEASE_TTL_MS): boolean {
	return (
		lease.yieldsUsed > 0 &&
		lease.startedAtMs !== undefined &&
		nowMs - lease.startedAtMs >= ttlMs
	);
}

/** An in-flight turn stays active regardless of lease age; restoration has priority. */
export function leaseState(lease: BoostLeaseState, nowMs: number, ttlMs = BOOST_LEASE_TTL_MS): string {
	if (lease.revertFailed) return "blocked";
	if (lease.originalModel) return "active";
	if (leaseExpired(lease, nowMs, ttlMs)) return "expired";
	return "off";
}

/** Human renewal never clears an active turn or failed baseline restoration. */
export function renewExpiredLease(lease: BoostLeaseState, nowMs: number, ttlMs: number): boolean {
	if (leaseState(lease, nowMs, ttlMs) !== "expired") return false;
	lease.yieldsUsed = 0;
	lease.startedAtMs = undefined;
	return true;
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
	expired: "expired (next /boost renews)",
	active: "active",
	off: "off",
};
