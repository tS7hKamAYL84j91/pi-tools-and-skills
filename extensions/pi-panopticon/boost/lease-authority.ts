/** Principal-gated, mock-only ADR-045 boost lease authority. */

import { validateActivationPrerequisites } from "./authority-policy.js";
import type {
	ActivateBoostInput,
	BoostActivationGrant,
	BoostDenialReason,
	BoostDispatchDecision,
	BoostFailureCategory,
	BoostLeaseDependencies,
	BoostLeaseOptions,
	BoostLeaseStatus,
	BoostResult,
	ReserveBoostInput,
	ResetBoostInput,
	SettleBoostInput,
	TerminateBoostInput,
} from "./contracts.js";
import { activateReservedBoostLease } from "./lease-activation.js";
import { denyBoostLease, revertBoostLease } from "./lease-lifecycle.js";
import type { BoostLeaseRecord } from "./lease-record.js";
import { reserveBoostLease } from "./lease-reservation.js";
import { leaseStatus } from "./reversion.js";

/** Holds at most one lease and exposes decisions, never provider dispatch. */
export class BoostLeaseAuthority {
	private readonly owner = Symbol("boost-lease-owner");
	private currentLease?: BoostLeaseRecord;
	private fallbackId = 0;

	constructor(
		private readonly dependencies: BoostLeaseDependencies,
		private readonly options: BoostLeaseOptions,
	) {
		if (
			!Number.isFinite(options.leaseDurationMs) ||
			options.leaseDurationMs <= 0
		) {
			throw new Error("leaseDurationMs must be positive");
		}
	}

	reserve(input: ReserveBoostInput): BoostResult<BoostLeaseStatus> {
		const expiry = this.expireIfNeeded();
		if (expiry && !expiry.ok) {
			return expiry;
		}
		return reserveBoostLease({
			dependencies: this.dependencies,
			options: this.options,
			owner: this.owner,
			state: {
				getLease: () => this.currentLease,
				setLease: (lease) => {
					this.currentLease = lease;
				},
				nextId: (kind) => this.nextId(kind),
			},
			request: input,
		});
	}

	activate(input: ActivateBoostInput): BoostResult<BoostActivationGrant> {
		const expiry = this.expireIfNeeded();
		if (expiry && !expiry.ok) {
			return expiry;
		}
		const lease = this.currentLease;
		const validation = validateActivationPrerequisites(
			this.dependencies,
			this.owner,
			input,
			lease,
		);
		if (validation) {
			return validation.category && lease
				? this.deny(lease, validation.reason, validation.category)
				: { ok: false, reason: validation.reason };
		}
		if (!lease) {
			return { ok: false, reason: "lease-not-found" };
		}
		return activateReservedBoostLease(this.dependencies, lease, input, {
			deny: (target, reason, category) => this.deny(target, reason, category),
			revertAndDeny: (target, reason, category) =>
				this.revertAndDeny(target, reason, category),
		});
	}

	settle(input: SettleBoostInput): BoostResult<BoostLeaseStatus> {
		const expiry = this.expireIfNeeded();
		if (expiry) {
			return expiry;
		}
		const lease = this.currentLease;
		if (!lease || lease.leaseId !== input.leaseId) {
			return { ok: false, reason: "lease-not-found" };
		}
		if (
			lease.state !== "Active" ||
			lease.activeActivationId !== input.activationId
		) {
			return { ok: false, reason: "lease-not-active" };
		}
		if (input.outcome === "visible" || input.outcome === "collapsed-visible") {
			lease.consumedYields += 1;
		}
		const targetState =
			lease.consumedYields >= lease.requestedYields ? "Idle" : "Reserved";
		return this.revert(lease, targetState);
	}

	cleanupExpired(): BoostResult<BoostLeaseStatus> {
		const lease = this.currentLease;
		if (!lease) {
			return { ok: true, value: { state: "Idle" } };
		}
		if (lease.state === "RevertFailed") {
			return { ok: false, reason: "revert-failed" };
		}
		if (this.dependencies.now() < lease.expiresAt) {
			return { ok: true, value: leaseStatus(lease) };
		}
		return this.revert(lease, "Idle", "expired");
	}

	terminate(input: TerminateBoostInput): BoostResult<BoostLeaseStatus> {
		const lease = this.currentLease;
		if (!lease || lease.leaseId !== input.leaseId) {
			return { ok: false, reason: "lease-not-found" };
		}
		if (lease.state === "RevertFailed") {
			return { ok: false, reason: "revert-failed" };
		}
		return this.revert(
			lease,
			"Idle",
			input.reason === "restart" ? "restart" : "session-transfer",
		);
	}

	reset(input: ResetBoostInput): BoostResult<BoostLeaseStatus> {
		const lease = this.currentLease;
		if (input.actor.kind !== "principal") {
			return { ok: false, reason: "unauthorized" };
		}
		if (!lease || lease.subjectId !== input.subjectId) {
			return { ok: false, reason: "lease-not-found" };
		}
		if (lease.issuerId !== input.actor.issuerId) {
			return { ok: false, reason: "issuer-mismatch" };
		}
		return this.revert(lease, "Idle");
	}

	getStatus(actor: {
		readonly kind: string;
		readonly issuerId: string;
	}): BoostResult<BoostLeaseStatus> {
		if (actor.kind !== "principal") {
			return { ok: false, reason: "unauthorized" };
		}
		if (this.currentLease && this.currentLease.issuerId !== actor.issuerId) {
			return { ok: false, reason: "issuer-mismatch" };
		}
		return this.cleanupExpired();
	}

	checkDispatch(subjectId: string): BoostDispatchDecision {
		if (
			this.currentLease?.state === "RevertFailed" &&
			this.currentLease.subjectId === subjectId
		) {
			return { allowed: false, reason: "revert-failed" };
		}
		return { allowed: true };
	}

	prepareNonBoostDispatch(subjectId: string): BoostDispatchDecision {
		const lease = this.currentLease;
		if (!lease || lease.subjectId !== subjectId) {
			return { allowed: true };
		}
		if (lease.state === "RevertFailed") {
			return { allowed: false, reason: "revert-failed" };
		}
		if (lease.state === "Active" && !this.revert(lease, "Reserved").ok) {
			return { allowed: false, reason: "revert-failed" };
		}
		return { allowed: true };
	}

	private deny<T>(
		lease: BoostLeaseRecord,
		reason: BoostDenialReason,
		category: BoostFailureCategory,
	): BoostResult<T> {
		return denyBoostLease({
			dependencies: this.dependencies,
			lease,
			reason,
			category,
		});
	}

	private revertAndDeny(
		lease: BoostLeaseRecord,
		reason: BoostDenialReason,
		category: BoostFailureCategory,
	): BoostResult<BoostActivationGrant> {
		const result = this.revert(
			lease,
			"Reserved",
			category,
			category === "audit-write-failed" ? category : undefined,
		);
		return result.ok ? { ok: false, reason } : result;
	}

	private revert(
		lease: BoostLeaseRecord,
		targetState: "Reserved" | "Idle",
		category?: BoostFailureCategory,
		forceFailure?: BoostFailureCategory,
	): BoostResult<BoostLeaseStatus> {
		const result = revertBoostLease({
			dependencies: this.dependencies,
			owner: this.owner,
			lease,
			targetState,
			...(category ? { category } : {}),
			...(forceFailure ? { forceFailure } : {}),
		});
		if (result.ok && targetState === "Idle") {
			this.currentLease = undefined;
		}
		return result;
	}

	private expireIfNeeded(): BoostResult<BoostLeaseStatus> | undefined {
		if (
			this.currentLease &&
			this.dependencies.now() >= this.currentLease.expiresAt
		) {
			return this.cleanupExpired();
		}
		return undefined;
	}

	private nextId(kind: "lease" | "subject" | "issuer"): string {
		try {
			const candidate = this.dependencies.ids.next(kind);
			if (/^[A-Za-z0-9_-]{1,64}$/.test(candidate)) {
				return candidate;
			}
		} catch {
			// Invalid id sources fall back to bounded opaque values.
		}
		this.fallbackId += 1;
		return `${kind}-opaque-${this.fallbackId}`;
	}
}
