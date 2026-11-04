/** Pi/settings adapter for boost lease presentation. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveLeaseMinutes, resolveMaxYields } from "./boost-settings.js";
import { leaseState, type BoostLeaseState, type LeaseStatus } from "./lease-state.js";

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
