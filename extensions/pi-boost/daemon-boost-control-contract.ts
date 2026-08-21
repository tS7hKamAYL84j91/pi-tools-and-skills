/** Bounded daemon boost WAL and transactional store contracts. */

export type DaemonBoostLeaseState = "Reserved" | "Active" | "Revoking";
export type DaemonBoostBlockedCategory =
	| "restore-failed"
	| "audit-failed"
	| "cleanup-failed"
	| "shutdown-recovery";
export type DaemonBoostStoreReason =
	| "blocked-subject"
	| "global-lease-occupied"
	| "invalid-yield-budget"
	| "lease-not-found"
	| "lease-not-active"
	| "stale-activation"
	| "cas-conflict"
	| "wal-unavailable";

export interface DaemonBoostLeaseKey {
	readonly enablementId: string;
	readonly subjectId: string;
	readonly leaseId: string;
}

interface DaemonBoostWalBase extends DaemonBoostLeaseKey {
	readonly sequence: number;
}

interface ReserveWalRecord extends DaemonBoostWalBase {
	readonly action: "reserve";
	readonly requestedYields: number;
	readonly expiresAt: number;
}

interface ActivateWalRecord extends DaemonBoostWalBase {
	readonly action: "activate";
	readonly generation: number;
}

interface RevokeWalRecord extends DaemonBoostWalBase {
	readonly action: "revoking";
	readonly generation: number;
}

interface ConsumeWalRecord extends DaemonBoostWalBase {
	readonly action: "consume";
	readonly consumedYields: number;
	readonly generation: number;
}

interface ReleaseWalRecord extends DaemonBoostWalBase {
	readonly action: "release";
}

interface BlockWalRecord extends DaemonBoostWalBase {
	readonly action: "block";
	readonly category: DaemonBoostBlockedCategory;
}

interface ResetWalRecord extends DaemonBoostWalBase {
	readonly action: "reset-block";
}

export type DaemonBoostWalRecord =
	| ReserveWalRecord
	| ActivateWalRecord
	| RevokeWalRecord
	| ConsumeWalRecord
	| ReleaseWalRecord
	| BlockWalRecord
	| ResetWalRecord;

export interface DaemonBoostWal {
	read(): Promise<readonly DaemonBoostWalRecord[]>;

	/** Atomically appends only when the durable sequence still matches. */
	appendIfSequence(
		expectedSequence: number,
		record: DaemonBoostWalRecord,
	): Promise<"appended" | "conflict">;
}

export interface DaemonBoostReserveInput extends DaemonBoostLeaseKey {
	readonly requestedYields: number;
	readonly externalYieldCeiling: number;
	/** Optional narrower descriptor/live-control expiry; WAL format remains unchanged. */
	readonly expiresAt?: number;
	readonly now: number;
}

export interface DaemonBoostConsumeInput extends DaemonBoostLeaseKey {
	readonly generation: number;
	readonly humanVisible: boolean;
}

export interface DaemonBoostBlockInput extends DaemonBoostLeaseKey {
	readonly category: DaemonBoostBlockedCategory;
}

export interface DaemonBoostLeaseSnapshot extends DaemonBoostLeaseKey {
	readonly state: DaemonBoostLeaseState;
	readonly requestedYields: number;
	readonly consumedYields: number;
	readonly generation: number;
	readonly expiresAt: number;
}

export interface DaemonBoostStoreSnapshot {
	readonly leases: readonly DaemonBoostLeaseSnapshot[];
	readonly blockedSubjects: readonly {
		readonly subjectId: string;
		readonly category: DaemonBoostBlockedCategory;
	}[];
}

export type DaemonBoostStoreResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: DaemonBoostStoreReason };

export interface MutableDaemonBoostLease extends DaemonBoostLeaseKey {
	state: DaemonBoostLeaseState;
	readonly requestedYields: number;
	consumedYields: number;
	generation: number;
	readonly expiresAt: number;
}
