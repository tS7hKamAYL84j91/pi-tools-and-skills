/** Boost lease state machine: single global lease, 3-yield cap, configurable TTL. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	BOOST_LEASE_TTL_MS,
	resolveLeaseMinutes,
	resolveMaxYields,
} from "./boost-settings.js";

/** Minimal model shape used for boost switching (avoids pi's internal Model type). */
export interface BoostCandidateModel {
	readonly provider: string;
	readonly id: string;
	readonly input: readonly string[];
}

interface BoostLeaseState {
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

export type LeaseStatus = "blocked" | "active" | "expired" | "off";

/** An in-flight turn stays active regardless of lease age; restoration has priority. */
export function leaseState(lease: BoostLeaseState, nowMs: number, ttlMs = BOOST_LEASE_TTL_MS): LeaseStatus {
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
const POWERLINE_LABELS = {
	blocked: "blocked · restore failed",
	expired: "expired",
	active: "active",
	off: "off",
} satisfies Record<LeaseStatus, string>;

/** /boost status labels. */
export const STATUS_LABELS = {
	blocked: "blocked (restore failed)",
	expired: "expired (next /boost renews)",
	active: "active",
	off: "off",
} satisfies Record<LeaseStatus, string>;

// ── Lease presentation and settle ────────────────────────────────

const SETTLE_POLL_MS = 100;
const SETTLE_TIMEOUT_MS = 30_000;

/**
 * Wait until the agent has fully settled (no streaming, no queued messages).
 * agent_end fires before auto-retry/compaction/follow-ups; poll the idle and
 * pending state until the run is truly drained, bounded by a timeout.
 */
export async function waitForSettled(ctx: ExtensionContext): Promise<void> {
	const deadline = Date.now() + SETTLE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (ctx.isIdle() && !ctx.hasPendingMessages()) return;
		await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
	}
}

/** Powerline shows only lease state and remaining yields — never prompt or model text (ADR-057). */
export async function updateStatus(
	ctx: ExtensionContext,
	lease: BoostLeaseState,
): Promise<void> {
	if (!ctx.hasUI) return;
	const maxYields = await resolveMaxYields();
	const remaining = Math.max(0, maxYields - lease.yieldsUsed);
	const leaseMinutes = await resolveLeaseMinutes();
	const state = leaseState(lease, Date.now(), leaseMinutes * 60_000);
	ctx.ui.setStatus(
		"boost",
		`Boost ${POWERLINE_LABELS[state]} · ${remaining} left`,
	);
}
