/** In-memory projection applied only after durable boost WAL appends. */

import type {
	DaemonBoostBlockedCategory,
	DaemonBoostLeaseKey,
	DaemonBoostLeaseSnapshot,
	DaemonBoostStoreResult,
	DaemonBoostStoreSnapshot,
	DaemonBoostWal,
	DaemonBoostWalRecord,
	MutableDaemonBoostLease,
} from "./daemon-boost-control-contract.js";

export class DaemonBoostWalState {
	private readonly leases = new Map<string, MutableDaemonBoostLease>();
	private readonly blockedSubjects = new Map<
		string,
		DaemonBoostBlockedCategory
	>();
	// Retains fail-closed recovery state when the daemon WAL cannot append.
	private readonly recoveryBlocks = new Map<
		string,
		DaemonBoostBlockedCategory
	>();
	private nextSequenceValue = 1;
	private globalLeaseId?: string;

	constructor(private readonly wal: DaemonBoostWal) {}

	async replay(): Promise<void> {
		const records = await this.wal.read();
		this.leases.clear();
		this.blockedSubjects.clear();
		this.globalLeaseId = undefined;
		this.nextSequenceValue = 1;
		for (const record of [...records].sort(
			(left, right) => left.sequence - right.sequence,
		)) {
			this.apply(record);
			this.nextSequenceValue = Math.max(
				this.nextSequenceValue,
				record.sequence + 1,
			);
		}
		this.applyRecoveryBlocks();
	}

	recoverIncompleteLeases(): void {
		for (const lease of this.leases.values()) {
			this.recoveryBlocks.set(lease.subjectId, "shutdown-recovery");
		}
		this.applyRecoveryBlocks();
	}

	nextSequence(): number {
		return this.nextSequenceValue;
	}

	hasGlobalLease(): boolean {
		return this.globalLeaseId !== undefined;
	}

	isBlocked(subjectId: string): boolean {
		return this.blockedSubjects.has(subjectId);
	}

	matchingLease(key: DaemonBoostLeaseKey): MutableDaemonBoostLease | undefined {
		const lease = this.leases.get(key.leaseId);
		return lease &&
			lease.enablementId === key.enablementId &&
			lease.subjectId === key.subjectId
			? lease
			: undefined;
	}

	activeLease(
		input: DaemonBoostLeaseKey & { readonly generation: number },
	): DaemonBoostStoreResult<MutableDaemonBoostLease> {
		const lease = this.matchingLease(input);
		if (!lease) {
			return { ok: false, reason: "lease-not-found" };
		}
		if (lease.generation !== input.generation) {
			return { ok: false, reason: "stale-activation" };
		}
		if (lease.state !== "Active") {
			return { ok: false, reason: "lease-not-active" };
		}
		return { ok: true, value: lease };
	}

	async append(
		record: DaemonBoostWalRecord,
	): Promise<"cas-conflict" | "wal-unavailable" | undefined> {
		try {
			const result = await this.wal.appendIfSequence(
				record.sequence - 1,
				record,
			);
			if (result === "conflict") {
				return "cas-conflict";
			}
		} catch {
			return "wal-unavailable";
		}
		this.apply(record);
		this.nextSequenceValue += 1;
		return undefined;
	}

	snapshot(): DaemonBoostStoreSnapshot {
		return {
			leases: [...this.leases.values()]
				.map(snapshotDaemonLease)
				.sort((left, right) => left.leaseId.localeCompare(right.leaseId)),
			blockedSubjects: [...this.blockedSubjects]
				.map(([subjectId, category]) => ({ subjectId, category }))
				.sort((left, right) => left.subjectId.localeCompare(right.subjectId)),
		};
	}

	private apply(record: DaemonBoostWalRecord): void {
		switch (record.action) {
			case "reserve":
				this.leases.set(record.leaseId, {
					enablementId: record.enablementId,
					subjectId: record.subjectId,
					leaseId: record.leaseId,
					requestedYields: record.requestedYields,
					consumedYields: 0,
					generation: 0,
					state: "Reserved",
				});
				this.globalLeaseId = record.leaseId;
				break;
			case "activate": {
				const lease = this.requireLease(record.leaseId);
				lease.generation = record.generation;
				lease.state = "Active";
				break;
			}
			case "revoking": {
				const lease = this.requireLease(record.leaseId);
				lease.generation = record.generation;
				lease.state = "Revoking";
				break;
			}
			case "consume": {
				const lease = this.requireLease(record.leaseId);
				lease.consumedYields = record.consumedYields;
				lease.state = "Reserved";
				break;
			}
			case "release":
				this.deleteLease(record.leaseId);
				break;
			case "block":
				this.blockedSubjects.set(record.subjectId, record.category);
				this.recoveryBlocks.delete(record.subjectId);
				this.deleteLease(record.leaseId);
				break;
			case "reset-block":
				this.blockedSubjects.delete(record.subjectId);
				this.recoveryBlocks.delete(record.subjectId);
		}
	}

	private applyRecoveryBlocks(): void {
		for (const [subjectId, category] of this.recoveryBlocks) {
			this.blockedSubjects.set(subjectId, category);
			for (const lease of [...this.leases.values()]) {
				if (lease.subjectId === subjectId) {
					this.deleteLease(lease.leaseId);
				}
			}
		}
	}

	private requireLease(leaseId: string): MutableDaemonBoostLease {
		const lease = this.leases.get(leaseId);
		if (!lease) {
			throw new Error("Invalid daemon boost WAL sequence");
		}
		return lease;
	}

	private deleteLease(leaseId: string): void {
		this.leases.delete(leaseId);
		if (this.globalLeaseId === leaseId) {
			this.globalLeaseId = undefined;
		}
	}
}

export function snapshotDaemonLease(
	lease: MutableDaemonBoostLease,
): DaemonBoostLeaseSnapshot {
	return {
		enablementId: lease.enablementId,
		subjectId: lease.subjectId,
		leaseId: lease.leaseId,
		state: lease.state,
		requestedYields: lease.requestedYields,
		consumedYields: lease.consumedYields,
		generation: lease.generation,
	};
}
