/** Deterministic host-owned implementation of the injected live boost bridge. */

import type {
	LiveBoostDenialReason,
	LiveBoostDispatchInput,
	LiveBoostLeaseStatus,
	LiveBoostReserveInput,
	LiveBoostResetInput,
	LiveBoostResult,
	LiveBoostRuntimeBridge,
	LiveBoostRuntimeDependencies,
	LiveBoostTerminalEvent,
} from "./live-boost-bridge-contract.js";
import { LiveBoostFinalizer } from "./live-boost-finalizer.js";
import { LiveBoostRuntimeState } from "./live-boost-runtime-state.js";
import { validateLiveBoostControl } from "./live-boost-control-contract.js";
import { resolveBoostThinking } from "./boost-descriptor.js";
import { resolveCurrentBoostDescriptor } from "./boost-descriptor-gate.js";
import { redactedBoostAuditId } from "./redacted-boost-audit.js";
import {
	isPrincipal,
	liveBoostStatus,
	mapLiveBoostStoreReason,
	resolveSelectedModel,
	sameControl,
} from "./live-boost-runtime-helpers.js";

export type {
	LiveBoostAuditRecord,
	LiveBoostProviderRequest,
	LiveBoostTerminalEvent,
} from "./live-boost-bridge-contract.js";

/** The bridge is constructible only by a host that supplies every capability. */
export class HostInjectedLiveBoostRuntime implements LiveBoostRuntimeBridge {
	private readonly state = new LiveBoostRuntimeState();
	private readonly finalizer: LiveBoostFinalizer;

	constructor(private readonly dependencies: LiveBoostRuntimeDependencies) {
		this.finalizer = new LiveBoostFinalizer(dependencies, this.state);
	}

	async reserve(
		input: LiveBoostReserveInput,
	): Promise<LiveBoostResult<LiveBoostLeaseStatus>> {
		if (!isPrincipal(input.caller)) {
			return { ok: false, reason: "unauthorized" };
		}
		await this.releaseExpiredLeases();
		const record = await this.dependencies.control.resolve(input.control);
		if (!validateLiveBoostControl(input.control, record, {
			issuerId: input.caller.issuerId,
			requestedYields: input.request.requestedYields,
			now: this.dependencies.now(),
		})) {
			return { ok: false, reason: "control-invalid" };
		}
		const descriptor = await resolveCurrentBoostDescriptor({ descriptor: this.dependencies.descriptor, models: this.dependencies.models, control: input.control, issuerId: input.caller.issuerId, requestedYields: input.request.requestedYields });
		if (!descriptor) {
			return { ok: false, reason: "control-invalid" };
		}
		const thinking = resolveBoostThinking(descriptor.descriptor, this.dependencies.thinkingPolicy);
		if (!thinking) {
			return { ok: false, reason: "control-invalid" };
		}
		const subscription = this.dependencies.control.subscribe(
			input.control,
			async (revision) => this.finalizer.handleRevision(revision),
		);
		if (!subscription || !record) {
			return { ok: false, reason: "control-unavailable" };
		}
		const leaseId = this.dependencies.nextLeaseId();
		const reserved = await this.dependencies.store.reserve({
			enablementId: input.control.enablementId,
			subjectId: input.subject.subjectId,
			leaseId,
			requestedYields: input.request.requestedYields,
			externalYieldCeiling: Math.min(record.maximumYields, descriptor.descriptor.maximumYields),
			expiresAt: Math.min(record.expiresAt, descriptor.descriptor.expiresAt),
			now: this.dependencies.now(),
		});
		if (!reserved.ok) {
			subscription.unsubscribe();
			return {
				ok: false,
				reason:
					reserved.reason === "blocked-subject"
						? "revert-failed"
						: "budget-denied",
			};
		}
		this.state.addLease({
			key: {
				enablementId: input.control.enablementId,
				subjectId: input.subject.subjectId,
				leaseId,
			},
			issuerId: input.caller.issuerId,
			requestedYields: input.request.requestedYields,
			expiresAt: reserved.value.expiresAt,
			control: input.control,
			descriptor,
			thinking,
			subscription,
		});
		return { ok: true, value: liveBoostStatus(reserved.value) };
	}

	async dispatch(
		input: LiveBoostDispatchInput,
	): Promise<LiveBoostResult<LiveBoostTerminalEvent>> {
		const lease = this.state.getLease(input.leaseId);
		if (
			!isPrincipal(input.caller) ||
			input.caller.issuerId !== lease?.issuerId
		) {
			return { ok: false, reason: "unauthorized" };
		}
		if (!lease || lease.key.subjectId !== input.subjectId) {
			return { ok: false, reason: "lease-not-found" };
		}
		if (!sameControl(input.control, lease.control)) {
			return { ok: false, reason: "control-invalid" };
		}
		if (this.isDispatchBlocked(input.subjectId)) {
			return { ok: false, reason: "revert-failed" };
		}
		if (lease.expiresAt <= this.dependencies.now()) {
			await this.finalizer.expireLease(lease);
			return { ok: false, reason: "expired" };
		}
		const record = await this.dependencies.control.resolve(input.control);
		if (!validateLiveBoostControl(input.control, record, {
			issuerId: input.caller.issuerId,
			requestedYields: lease.requestedYields,
			now: this.dependencies.now(),
		})) {
			const reason: LiveBoostDenialReason =
				record && record.expiresAt <= this.dependencies.now()
					? "expired"
					: "control-invalid";
			await this.finalizer.releaseReserved(lease);
			return { ok: false, reason };
		}
		const descriptor = await resolveCurrentBoostDescriptor({ descriptor: this.dependencies.descriptor, models: this.dependencies.models, control: input.control, issuerId: input.caller.issuerId, requestedYields: lease.requestedYields });
		if (!descriptor || descriptor.fingerprint !== lease.descriptor.fingerprint) {
			const reason: LiveBoostDenialReason =
				record && record.expiresAt <= this.dependencies.now()
					? "expired"
					: "control-invalid";
			await this.finalizer.releaseReserved(lease);
			return { ok: false, reason };
		}
		let governance: string;
		try {
			governance = await this.dependencies.governance.classify(
				input.combinedInput,
			);
		} catch {
			await this.finalizer.releaseReserved(lease);
			return { ok: false, reason: "governance-denied" };
		}
		if (governance !== "public") {
			await this.finalizer.releaseReserved(lease);
			return { ok: false, reason: "governance-denied" };
		}
		const thinking = resolveBoostThinking(descriptor.descriptor, this.dependencies.thinkingPolicy);
		if (!thinking || thinking.policyRevision !== lease.thinking.policyRevision ||
			thinking.thinkingLevel !== lease.thinking.thinkingLevel) {
			await this.finalizer.releaseReserved(lease);
			return { ok: false, reason: "control-invalid" };
		}
		const model = resolveSelectedModel(this.dependencies.models, descriptor);
		if (!model) {
			await this.finalizer.releaseReserved(lease);
			return { ok: false, reason: "control-invalid" };
		}
		const activated = await this.dependencies.store.activate(lease.key);
		if (!activated.ok) {
			return { ok: false, reason: mapLiveBoostStoreReason(activated.reason) };
		}
		const active = this.state.startProviderDispatch(
			this.dependencies,
			lease,
			activated.value.generation,
			input,
			model,
			thinking,
		);
		return this.finalizer.finalizeAfterProvider(active, await active.terminal);
	}

	async reset(
		input: LiveBoostResetInput,
	): Promise<LiveBoostResult<{ readonly reset: true }>> {
		if (!isPrincipal(input.caller)) {
			return { ok: false, reason: "unauthorized" };
		}
		const record = await this.dependencies.control.resolve(input.control);
		if (!validateLiveBoostControl(input.control, record, {
			issuerId: input.caller.issuerId,
			requestedYields: 1,
			now: this.dependencies.now(),
		})) {
			return { ok: false, reason: "control-invalid" };
		}
		const descriptor = await resolveCurrentBoostDescriptor({ descriptor: this.dependencies.descriptor, models: this.dependencies.models, control: input.control, issuerId: input.caller.issuerId, requestedYields: 1 });
		if (!descriptor) {
			return { ok: false, reason: "control-invalid" };
		}
		try {
			await this.dependencies.baseline.restore(input.subjectId);
			await this.dependencies.audit.append({
				timestamp: this.dependencies.now(),
				phase: "reset",
				enablementId: redactedBoostAuditId(
					"enablement",
					input.control.enablementId,
				),
				subjectId: redactedBoostAuditId("subject", input.subjectId),
				leaseId: redactedBoostAuditId("lease", "blocked-subject"),
			});
		} catch {
			return { ok: false, reason: "revert-failed" };
		}
		const reset = await this.dependencies.store.resetBlocked(input.subjectId);
		if (!reset.ok) {
			return { ok: false, reason: "revert-failed" };
		}
		this.state.clearFailClosed(input.subjectId);
		return { ok: true, value: { reset: true } };
	}

	async getStatus(input: {
		readonly caller: { readonly kind: string; readonly issuerId: string };
		readonly subjectId: string;
	}) {
		if (!isPrincipal(input.caller)) {
			return { ok: false as const, reason: "unauthorized" as const };
		}
		if (this.isDispatchBlocked(input.subjectId)) {
			return { ok: true as const, value: { state: "RevertFailed" as const } };
		}
		const lease = this.state
			.allLeases()
			.find(
				(candidate) =>
					candidate.key.subjectId === input.subjectId &&
					candidate.issuerId === input.caller.issuerId,
			);
		if (!lease) {
			return { ok: true as const, value: { state: "Idle" as const } };
		}
		if (lease.expiresAt <= this.dependencies.now()) {
			await this.finalizer.expireLease(lease);
			return { ok: true as const, value: { state: "Idle" as const } };
		}
		const snapshot = this.dependencies.store
			.snapshot()
			.leases.find((candidate) => candidate.leaseId === lease.key.leaseId);
		return snapshot
			? { ok: true as const, value: liveBoostStatus(snapshot) }
			: { ok: true as const, value: { state: "Idle" as const } };
	}

	checkDispatch(subjectId: string) {
		return this.isDispatchBlocked(subjectId)
			? { allowed: false as const, reason: "revert-failed" as const }
			: { allowed: true as const };
	}

	async shutdown(input: {
		readonly choice: "synchronous-restore" | "durable-block-marker";
	}): Promise<void> {
		await this.finalizer.shutdown(input);
	}

	private async releaseExpiredLeases(): Promise<void> {
		const now = this.dependencies.now();
		for (const lease of this.state.allLeases()) {
			if (lease.expiresAt <= now) {
				await this.finalizer.expireLease(lease);
			}
		}
	}

	private isDispatchBlocked(subjectId: string): boolean {
		return (
			this.state.isFailClosed(subjectId) ||
			!this.dependencies.store.checkDispatch(subjectId).allowed
		);
	}
}
