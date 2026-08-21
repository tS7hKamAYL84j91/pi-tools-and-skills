/** Ephemeral host runtime state; prompts and provider results are never persisted here. */

import type { DaemonBoostLeaseKey } from "./daemon-boost-control-store.js";
import type {
	LiveBoostDispatchInput,
	LiveBoostResult,
	LiveBoostRuntimeDependencies,
	LiveBoostTerminalEvent,
} from "./live-boost-bridge-contract.js";
import { ProcessWideKeyedMutex } from "./process-wide-mutex.js";
import type {
	ExternalBoostConfigReference,
	ExternalBoostConfigSubscription,
} from "./external-boost-config-contract.js";

export interface RuntimeBoostLease {
	readonly key: DaemonBoostLeaseKey;
	readonly issuerId: string;
	readonly requestedYields: number;
	readonly expiresAt: number;
	readonly control: ExternalBoostConfigReference;
	readonly subscription: ExternalBoostConfigSubscription;
}

export interface ActiveBoostDispatch {
	readonly lease: RuntimeBoostLease;
	readonly generation: number;
	readonly controller: AbortController;
	readonly terminal: Promise<LiveBoostTerminalEvent>;
	readonly completion: Promise<LiveBoostResult<LiveBoostTerminalEvent>>;
	complete(result: LiveBoostResult<LiveBoostTerminalEvent>): void;
	revoking: boolean;
}

export class LiveBoostRuntimeState {
	private readonly leases = new Map<string, RuntimeBoostLease>();
	private readonly active = new Map<string, ActiveBoostDispatch>();
	private readonly failClosedSubjects = new Set<string>();
	private readonly lifecycleMutex = new ProcessWideKeyedMutex();

	addLease(lease: RuntimeBoostLease): void {
		this.leases.set(lease.key.leaseId, lease);
	}

	getLease(leaseId: string): RuntimeBoostLease | undefined {
		return this.leases.get(leaseId);
	}

	allLeases(): RuntimeBoostLease[] {
		return [...this.leases.values()];
	}

	activeFor(leaseId: string): ActiveBoostDispatch | undefined {
		return this.active.get(leaseId);
	}

	startProviderDispatch(
		dependencies: LiveBoostRuntimeDependencies,
		lease: RuntimeBoostLease,
		generation: number,
		input: LiveBoostDispatchInput,
	): ActiveBoostDispatch {
		const controller = new AbortController();
		let complete = (_result: LiveBoostResult<LiveBoostTerminalEvent>): void =>
			undefined;
		const completion = new Promise<LiveBoostResult<LiveBoostTerminalEvent>>(
			(resolve) => {
				complete = resolve;
			},
		);
		const terminal = dependencies.provider
			.dispatch(
				{
					enablementId: lease.key.enablementId,
					subjectId: lease.key.subjectId,
					leaseId: lease.key.leaseId,
					activationGeneration: generation,
					combinedInput: input.combinedInput,
					isolation: input.isolation,
				},
				controller.signal,
			)
			.catch(() => ({
				leaseId: lease.key.leaseId,
				activationGeneration: generation,
				outcome: "failed" as const,
				humanVisible: false,
			}));
		const active: ActiveBoostDispatch = {
			lease,
			generation,
			controller,
			terminal,
			completion,
			complete,
			revoking: false,
		};
		this.active.set(lease.key.leaseId, active);
		return active;
	}

	completeActive(
		active: ActiveBoostDispatch | undefined,
		result: LiveBoostResult<LiveBoostTerminalEvent>,
	): void {
		if (!active || this.active.get(active.lease.key.leaseId) !== active) {
			return;
		}
		this.active.delete(active.lease.key.leaseId);
		active.complete(result);
	}

	removeLease(lease: RuntimeBoostLease): void {
		lease.subscription.unsubscribe();
		this.leases.delete(lease.key.leaseId);
	}

	markFailClosed(subjectId: string): void {
		this.failClosedSubjects.add(subjectId);
	}

	clearFailClosed(subjectId: string): void {
		this.failClosedSubjects.delete(subjectId);
	}

	isFailClosed(subjectId: string): boolean {
		return this.failClosedSubjects.has(subjectId);
	}

	async withLeaseLock(
		leaseId: string,
		operation: () => Promise<void>,
	): Promise<void> {
		await this.lifecycleMutex.runExclusive(
			`boost:lifecycle:${leaseId}`,
			operation,
		);
	}
}
