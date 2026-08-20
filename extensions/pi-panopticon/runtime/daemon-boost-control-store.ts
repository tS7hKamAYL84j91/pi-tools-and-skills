/** WAL-backed daemon control transactions for host-owned boost leases. */

import type {
	DaemonBoostBlockInput,
	DaemonBoostConsumeInput,
	DaemonBoostLeaseKey,
	DaemonBoostLeaseSnapshot,
	DaemonBoostReserveInput,
	DaemonBoostStoreResult,
	DaemonBoostStoreSnapshot,
	DaemonBoostWal,
	DaemonBoostWalRecord,
} from "./daemon-boost-control-contract.js";
import {
	DaemonBoostWalState,
	snapshotDaemonLease,
} from "./daemon-boost-wal-state.js";
import { ProcessWideKeyedMutex } from "./process-wide-mutex.js";

export type {
	DaemonBoostBlockedCategory,
	DaemonBoostLeaseKey,
	DaemonBoostLeaseSnapshot,
	DaemonBoostWal,
	DaemonBoostWalRecord,
} from "./daemon-boost-control-contract.js";

const GLOBAL_LEASE_MUTEX_KEY = "boost:global-lease";
const MAX_BOOST_YIELDS = 3;

/** Durable test/host store; filesystem ownership remains in the injected daemon WAL. */
export class DaemonBoostControlStore {
	private readonly mutex = new ProcessWideKeyedMutex();
	private readonly state: DaemonBoostWalState;

	private constructor(wal: DaemonBoostWal) {
		this.state = new DaemonBoostWalState(wal);
	}

	static async open(wal: DaemonBoostWal): Promise<DaemonBoostControlStore> {
		const store = new DaemonBoostControlStore(wal);
		await store.state.replay();
		// A WAL-only lease has no live host context after restart, so it blocks.
		for (const lease of store.state.snapshot().leases) {
			const blocked = await store.markBlocked({
				enablementId: lease.enablementId,
				subjectId: lease.subjectId,
				leaseId: lease.leaseId,
				category: "shutdown-recovery",
			});
			if (!blocked.ok) {
				store.state.recoverIncompleteLeases();
				break;
			}
		}
		return store;
	}

	async reserve(
		input: DaemonBoostReserveInput,
	): Promise<DaemonBoostStoreResult<DaemonBoostLeaseSnapshot>> {
		return this.transaction(input.enablementId, async () => {
			if (!isValidBudget(input.requestedYields, input.qYieldCeiling)) {
				return { ok: false, reason: "invalid-yield-budget" };
			}
			if (this.state.isBlocked(input.subjectId)) {
				return { ok: false, reason: "blocked-subject" };
			}
			if (this.state.hasGlobalLease()) {
				return { ok: false, reason: "global-lease-occupied" };
			}
			const record: DaemonBoostWalRecord = {
				action: "reserve",
				sequence: this.state.nextSequence(),
				enablementId: input.enablementId,
				subjectId: input.subjectId,
				leaseId: input.leaseId,
				requestedYields: input.requestedYields,
			};
			const appendFailure = await this.state.append(record);
			if (appendFailure) {
				return { ok: false, reason: appendFailure };
			}
			const lease = this.state.matchingLease(input);
			if (!lease) {
				throw new Error("Missing appended daemon boost reservation");
			}
			return { ok: true, value: snapshotDaemonLease(lease) };
		});
	}

	async activate(
		key: DaemonBoostLeaseKey,
	): Promise<DaemonBoostStoreResult<{ readonly generation: number }>> {
		return this.transaction(key.enablementId, async () => {
			const lease = this.state.matchingLease(key);
			if (!lease) {
				return { ok: false, reason: "lease-not-found" };
			}
			if (lease.state !== "Reserved") {
				return { ok: false, reason: "lease-not-active" };
			}
			if (lease.consumedYields >= lease.requestedYields) {
				return { ok: false, reason: "invalid-yield-budget" };
			}
			const generation = lease.generation + 1;
			const appendFailure = await this.state.append({
				action: "activate",
				sequence: this.state.nextSequence(),
				...key,
				generation,
			});
			return appendFailure
				? { ok: false, reason: appendFailure }
				: { ok: true, value: { generation } };
		});
	}

	async markRevoking(
		input: DaemonBoostLeaseKey & { readonly generation: number },
	): Promise<DaemonBoostStoreResult<DaemonBoostLeaseSnapshot>> {
		return this.transaction(input.enablementId, async () => {
			const validation = this.state.activeLease(input);
			if (!validation.ok) {
				return validation;
			}
			const appendFailure = await this.state.append({
				action: "revoking",
				sequence: this.state.nextSequence(),
				...input,
				// Increment before aborting so racing terminal callbacks are stale.
				generation: input.generation + 1,
			});
			return appendFailure
				? { ok: false, reason: appendFailure }
				: { ok: true, value: snapshotDaemonLease(validation.value) };
		});
	}

	async consume(
		input: DaemonBoostConsumeInput,
	): Promise<DaemonBoostStoreResult<DaemonBoostLeaseSnapshot>> {
		return this.transaction(input.enablementId, async () => {
			const validation = this.state.activeLease(input);
			if (!validation.ok) {
				return validation;
			}
			const lease = validation.value;
			const consumedYields = input.humanVisible
				? lease.consumedYields + 1
				: lease.consumedYields;
			if (consumedYields > lease.requestedYields) {
				return { ok: false, reason: "invalid-yield-budget" };
			}
			const appendFailure = await this.state.append({
				action: "consume",
				sequence: this.state.nextSequence(),
				enablementId: input.enablementId,
				subjectId: input.subjectId,
				leaseId: input.leaseId,
				generation: input.generation,
				consumedYields,
			});
			return appendFailure
				? { ok: false, reason: appendFailure }
				: { ok: true, value: snapshotDaemonLease(lease) };
		});
	}

	async release(
		key: DaemonBoostLeaseKey,
	): Promise<DaemonBoostStoreResult<{ readonly released: true }>> {
		return this.transaction(key.enablementId, async () => {
			if (!this.state.matchingLease(key)) {
				return { ok: false, reason: "lease-not-found" };
			}
			const appendFailure = await this.state.append({
				action: "release",
				sequence: this.state.nextSequence(),
				...key,
			});
			return appendFailure
				? { ok: false, reason: appendFailure }
				: { ok: true, value: { released: true } };
		});
	}

	async markBlocked(
		input: DaemonBoostBlockInput,
	): Promise<DaemonBoostStoreResult<{ readonly blocked: true }>> {
		return this.transaction(input.enablementId, async () => {
			const appendFailure = await this.state.append({
				action: "block",
				sequence: this.state.nextSequence(),
				...input,
			});
			return appendFailure
				? { ok: false, reason: appendFailure }
				: { ok: true, value: { blocked: true } };
		});
	}

	async resetBlocked(
		subjectId: string,
	): Promise<DaemonBoostStoreResult<{ readonly reset: true }>> {
		return this.transaction(subjectId, async () => {
			if (!this.state.isBlocked(subjectId)) {
				return { ok: false, reason: "lease-not-found" };
			}
			const appendFailure = await this.state.append({
				action: "reset-block",
				sequence: this.state.nextSequence(),
				enablementId: "blocked-subject-reset",
				subjectId,
				leaseId: "blocked-subject-reset",
			});
			return appendFailure
				? { ok: false, reason: appendFailure }
				: { ok: true, value: { reset: true } };
		});
	}

	checkDispatch(
		subjectId: string,
	):
		| { readonly allowed: true }
		| { readonly allowed: false; readonly reason: "revert-failed" } {
		return this.state.isBlocked(subjectId)
			? { allowed: false, reason: "revert-failed" }
			: { allowed: true };
	}

	snapshot(): DaemonBoostStoreSnapshot {
		return this.state.snapshot();
	}

	private async transaction<T>(
		enablementId: string,
		operation: () => Promise<DaemonBoostStoreResult<T>>,
	): Promise<DaemonBoostStoreResult<T>> {
		return this.mutex.runExclusive(GLOBAL_LEASE_MUTEX_KEY, async () =>
			this.mutex.runExclusive(`boost:enablement:${enablementId}`, async () => {
				for (let attempt = 0; attempt < 2; attempt += 1) {
					await this.state.replay();
					const result = await operation();
					if (!result.ok && result.reason === "cas-conflict") {
						continue;
					}
					return result;
				}
				return { ok: false, reason: "wal-unavailable" };
			}),
		);
	}
}

function isValidBudget(
	requestedYields: number,
	qYieldCeiling: number,
): boolean {
	return (
		Number.isSafeInteger(requestedYields) &&
		requestedYields >= 1 &&
		requestedYields <= MAX_BOOST_YIELDS &&
		Number.isSafeInteger(qYieldCeiling) &&
		qYieldCeiling >= requestedYields &&
		qYieldCeiling <= MAX_BOOST_YIELDS
	);
}
