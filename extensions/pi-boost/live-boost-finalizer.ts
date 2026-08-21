/** Serialized terminal, revocation, failure, and shutdown finalization. */

import type { BoostTerminalOutcome } from "./boost/contracts.js";
import type { DaemonBoostBlockedCategory } from "./daemon-boost-control-store.js";
import type {
	LiveBoostAuditRecord,
	LiveBoostDenialReason,
	LiveBoostResult,
	LiveBoostRuntimeDependencies,
	LiveBoostTerminalEvent,
} from "./live-boost-bridge-contract.js";
import type {
	ActiveBoostDispatch,
	LiveBoostRuntimeState,
	RuntimeBoostLease,
} from "./live-boost-runtime-state.js";
import type { ExternalBoostConfigRevision } from "./external-boost-config-contract.js";
import { redactedBoostAuditId } from "./redacted-boost-audit.js";

export class LiveBoostFinalizer {
	constructor(
		private readonly dependencies: LiveBoostRuntimeDependencies,
		private readonly state: LiveBoostRuntimeState,
	) {}

	async finalizeAfterProvider(
		active: ActiveBoostDispatch,
		terminal: LiveBoostTerminalEvent,
	): Promise<LiveBoostResult<LiveBoostTerminalEvent>> {
		let waitForRevocation = false;
		let result: LiveBoostResult<LiveBoostTerminalEvent> | undefined;
		await this.state.withLeaseLock(active.lease.key.leaseId, async () => {
			if (active.revoking) {
				waitForRevocation = true;
				return;
			}
			result = await this.finalizeTerminal(active, terminal);
		});
		return waitForRevocation ? active.completion : requireResult(result);
	}

	async handleRevision(revision: ExternalBoostConfigRevision): Promise<void> {
		const targets = this.state
			.allLeases()
			.filter((lease) => lease.key.enablementId === revision.enablementId);
		for (const lease of targets) {
			const active = this.state.activeFor(lease.key.leaseId);
			if (active) {
				await this.revokeActive(active, revision.reason);
			} else {
				await this.releaseReserved(lease);
			}
		}
	}

	async releaseReserved(lease: RuntimeBoostLease): Promise<void> {
		try {
			await this.dependencies.baseline.restore(lease.key.subjectId);
			await this.dependencies.audit.append(
				auditRecord(this.dependencies.now(), lease, "revoked"),
			);
			const released = await this.dependencies.store.release(lease.key);
			if (!released.ok) {
				throw new Error("release failed");
			}
			this.state.removeLease(lease);
		} catch {
			await this.blockSubject(lease, "cleanup-failed");
		}
	}

	async shutdown(input: {
		readonly choice: "synchronous-restore" | "durable-block-marker";
	}): Promise<void> {
		const leases = this.state.allLeases();
		if (input.choice === "synchronous-restore") {
			for (const lease of leases) {
				const active = this.state.activeFor(lease.key.leaseId);
				if (active) {
					await this.revokeActive(active, "shutdown");
				} else {
					await this.releaseReserved(lease);
				}
			}
			return;
		}
		for (const lease of leases) {
			const active = this.state.activeFor(lease.key.leaseId);
			if (active) {
				active.revoking = true;
				active.controller.abort("shutdown");
			}
			await this.blockSubject(lease, "shutdown-recovery");
			this.state.completeActive(active, { ok: false, reason: "shutdown" });
			this.state.removeLease(lease);
		}
	}

	private async finalizeTerminal(
		active: ActiveBoostDispatch,
		terminal: LiveBoostTerminalEvent,
	): Promise<LiveBoostResult<LiveBoostTerminalEvent>> {
		if (
			terminal.leaseId !== active.lease.key.leaseId ||
			terminal.activationGeneration !== active.generation
		) {
			await this.restoreAuditRelease(active, terminal.outcome, "terminal");
			return this.finish(active, { ok: false, reason: "stale-activation" });
		}
		try {
			await this.dependencies.baseline.restore(active.lease.key.subjectId);
		} catch {
			return this.failReversion(active, "restore-failed");
		}
		const consumed = await this.dependencies.store.consume({
			...active.lease.key,
			generation: active.generation,
			humanVisible: terminal.humanVisible,
		});
		if (!consumed.ok) {
			return this.failReversion(active, "cleanup-failed");
		}
		try {
			await this.appendTerminalAudit(active, terminal.outcome, "terminal");
		} catch {
			return this.failReversion(active, "audit-failed");
		}
		if (consumed.value.consumedYields >= consumed.value.requestedYields) {
			const released = await this.dependencies.store.release(active.lease.key);
			if (!released.ok) {
				return this.failReversion(active, "cleanup-failed");
			}
			this.state.removeLease(active.lease);
		}
		return this.finish(active, { ok: true, value: terminal });
	}

	private async revokeActive(
		active: ActiveBoostDispatch,
		reason: Exclude<LiveBoostDenialReason, "unauthorized">,
	): Promise<void> {
		if (active.revoking) {
			return;
		}
		// Invalidate synchronously before waiting for the durable generation bump.
		active.revoking = true;
		let revokeMarked = false;
		await this.state.withLeaseLock(active.lease.key.leaseId, async () => {
			const marked = await this.dependencies.store.markRevoking({
				...active.lease.key,
				generation: active.generation,
			});
			if (!marked.ok) {
				await this.failReversion(active, "cleanup-failed");
				return;
			}
			revokeMarked = true;
			active.controller.abort(reason);
		});
		if (!revokeMarked) {
			return;
		}
		const terminal = await active.terminal;
		await this.state.withLeaseLock(active.lease.key.leaseId, async () => {
			const restored = await this.restoreAuditRelease(
				active,
				terminal.outcome,
				"revoked",
			);
			this.state.completeActive(active, {
				ok: false,
				reason: restored ? reason : "revert-failed",
			});
		});
	}

	private async restoreAuditRelease(
		active: ActiveBoostDispatch,
		outcome: BoostTerminalOutcome,
		phase: "terminal" | "revoked",
	): Promise<boolean> {
		try {
			await this.dependencies.baseline.restore(active.lease.key.subjectId);
			await this.appendTerminalAudit(active, outcome, phase);
			const released = await this.dependencies.store.release(active.lease.key);
			if (!released.ok) {
				throw new Error("release failed");
			}
			this.state.removeLease(active.lease);
			return true;
		} catch {
			await this.failReversion(active, "cleanup-failed");
			return false;
		}
	}

	private async failReversion(
		active: ActiveBoostDispatch,
		category: DaemonBoostBlockedCategory,
	): Promise<LiveBoostResult<LiveBoostTerminalEvent>> {
		await this.blockSubject(active.lease, category);
		try {
			await this.dependencies.audit.append({
				...auditRecord(this.dependencies.now(), active.lease, "revert-failed"),
				activationGeneration: active.generation,
				failureCategory: category,
			});
		} catch {
			// The durable blocked marker remains the fail-closed source of truth.
		}
		this.state.removeLease(active.lease);
		return this.finish(active, { ok: false, reason: "revert-failed" });
	}

	private async blockSubject(
		lease: RuntimeBoostLease,
		category: DaemonBoostBlockedCategory,
	): Promise<void> {
		this.state.markFailClosed(lease.key.subjectId);
		const result = await this.dependencies.store.markBlocked({
			...lease.key,
			category,
		});
		if (result.ok) {
			return;
		}
		// The in-memory marker denies new work until the durable host recovers.
	}

	private async appendTerminalAudit(
		active: ActiveBoostDispatch,
		outcome: BoostTerminalOutcome,
		phase: "terminal" | "revoked",
	): Promise<void> {
		await this.dependencies.audit.append({
			...auditRecord(this.dependencies.now(), active.lease, phase),
			activationGeneration: active.generation,
			outcome,
		});
	}

	private finish(
		active: ActiveBoostDispatch,
		result: LiveBoostResult<LiveBoostTerminalEvent>,
	): LiveBoostResult<LiveBoostTerminalEvent> {
		this.state.completeActive(active, result);
		return result;
	}
}

function auditRecord(
	timestamp: number,
	lease: RuntimeBoostLease,
	phase: LiveBoostAuditRecord["phase"],
): LiveBoostAuditRecord {
	return {
		timestamp,
		phase,
		enablementId: redactedBoostAuditId("enablement", lease.key.enablementId),
		subjectId: redactedBoostAuditId("subject", lease.key.subjectId),
		leaseId: redactedBoostAuditId("lease", lease.key.leaseId),
	};
}

function requireResult<T>(
	result: LiveBoostResult<T> | undefined,
): LiveBoostResult<T> {
	if (!result) {
		throw new Error("Missing serialized boost lifecycle result");
	}
	return result;
}
