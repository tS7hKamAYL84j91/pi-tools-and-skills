import {
	DaemonBoostControlStore,
	type DaemonBoostWal,
	type DaemonBoostWalRecord,
} from "../../extensions/pi-boost/daemon-boost-control-store.js";
import {
	HostInjectedLiveBoostRuntime,
	type LiveBoostAuditRecord,
	type LiveBoostProviderRequest,
	type LiveBoostTerminalEvent,
} from "../../extensions/pi-boost/host-injected-live-boost.js";
import {
	Q_BOOST_BASELINE_KEY,
	Q_BOOST_LEASE_KEY,
	Q_BOOST_TEAM_ID,
	type QBoostControlAdapter,
	type QBoostControlRecord,
	type QBoostControlReference,
	type QBoostControlRevision,
	type QBoostControlSubscription,
} from "../../extensions/pi-boost/q-boost-control-contract.js";

export const TEST_CONTROL_REFERENCE: QBoostControlReference = {
	teamId: Q_BOOST_TEAM_ID,
	enablementId: "enablement-test",
	mappingVersion: 7,
	rollbackVersion: 3,
	baselineLogicalKey: Q_BOOST_BASELINE_KEY,
	leaseLogicalKey: Q_BOOST_LEASE_KEY,
};

export class TestDaemonWal implements DaemonBoostWal {
	readonly records: DaemonBoostWalRecord[] = [];
	readonly events?: string[];
	failNextAppend = false;

	constructor(events?: string[]) {
		this.events = events;
	}

	async read(): Promise<readonly DaemonBoostWalRecord[]> {
		return this.records;
	}

	async appendIfSequence(
		expectedSequence: number,
		record: DaemonBoostWalRecord,
	): Promise<"appended" | "conflict"> {
		if (this.failNextAppend) {
			this.failNextAppend = false;
			throw new Error("private WAL failure");
		}
		const actualSequence = this.records.at(-1)?.sequence ?? 0;
		if (actualSequence !== expectedSequence) {
			return "conflict";
		}
		this.records.push(structuredClone(record));
		this.events?.push(record.action);
		return "appended";
	}
}

class TestQBoostControlAdapter implements QBoostControlAdapter {
	resolveCount = 0;
	record: QBoostControlRecord;
	streamAvailable = true;
	private readonly listeners = new Set<
		(revision: QBoostControlRevision) => Promise<void>
	>();

	constructor(record: QBoostControlRecord) {
		this.record = record;
	}

	async resolve(
		_reference: QBoostControlReference,
	): Promise<QBoostControlRecord | undefined> {
		this.resolveCount += 1;
		return this.record;
	}

	subscribe(
		_reference: QBoostControlReference,
		listener: (revision: QBoostControlRevision) => Promise<void>,
	): QBoostControlSubscription | undefined {
		if (!this.streamAvailable) {
			return undefined;
		}
		this.listeners.add(listener);
		return {
			unsubscribe: () => {
				this.listeners.delete(listener);
			},
		};
	}

	async emit(reason: QBoostControlRevision["reason"]): Promise<void> {
		const revision: QBoostControlRevision = {
			enablementId: this.record.enablementId,
			revision: this.record.revision + 1,
			reason,
		};
		await Promise.all(
			[...this.listeners].map(async (listener) => listener(revision)),
		);
	}
}

interface LiveBoostTestHost {
	readonly audit: LiveBoostAuditRecord[];
	readonly bridge: HostInjectedLiveBoostRuntime;
	readonly control: TestQBoostControlAdapter;
	readonly dispatchRequests: LiveBoostProviderRequest[];
	readonly events: string[];
	readonly signals: AbortSignal[];
	readonly store: DaemonBoostControlStore;
	readonly wal: TestDaemonWal;
	resolveTerminal(event?: Partial<LiveBoostTerminalEvent>): void;
}

interface TestHostOverrides {
	readonly control?: Partial<QBoostControlRecord>;
	readonly restoreFailsFor?: string;
	readonly wal?: TestDaemonWal;
}

export async function createLiveBoostTestHost(
	overrides: TestHostOverrides = {},
): Promise<LiveBoostTestHost> {
	const events = overrides.wal?.events ?? [];
	const wal = overrides.wal ?? new TestDaemonWal(events);
	const store = await DaemonBoostControlStore.open(wal);
	const now = 10_000;
	const record: QBoostControlRecord = {
		schemaVersion: 2,
		protocol: "boost",
		teamId: Q_BOOST_TEAM_ID,
		enablementId: TEST_CONTROL_REFERENCE.enablementId,
		principalIssuerId: "principal-test",
		mappingVersion: TEST_CONTROL_REFERENCE.mappingVersion,
		rollbackVersion: TEST_CONTROL_REFERENCE.rollbackVersion,
		baselineLogicalKey: Q_BOOST_BASELINE_KEY,
		leaseLogicalKey: Q_BOOST_LEASE_KEY,
		maximumYields: 3,
		expiresAt: now + 60_000,
		revision: 11,
		enabled: true,
		signatureStatus: "verified",
		ownershipStatus: "principal-owned",
		residencyEvidence: "external-eligible",
		...overrides.control,
	};
	const control = new TestQBoostControlAdapter(record);
	const audit: LiveBoostAuditRecord[] = [];
	const dispatchRequests: LiveBoostProviderRequest[] = [];
	const signals: AbortSignal[] = [];
	let terminalResolver: ((event: LiveBoostTerminalEvent) => void) | undefined;
	const bridge = new HostInjectedLiveBoostRuntime({
		store,
		control,
		now: () => now,
		nextLeaseId: () => "lease-test",
		governance: { classify: async () => "public" },
		provider: {
			dispatch: async (request, signal) => {
				dispatchRequests.push(request);
				signals.push(signal);
				events.push("provider-dispatch");
				return new Promise<LiveBoostTerminalEvent>((resolve) => {
					terminalResolver = (event) => {
						events.push("terminal-acknowledgement");
						resolve(event);
					};
					signal.addEventListener(
						"abort",
						() => {
							events.push("abort");
							terminalResolver?.({
								leaseId: request.leaseId,
								activationGeneration: request.activationGeneration,
								outcome: "cancelled",
								humanVisible: false,
							});
						},
						{ once: true },
					);
				});
			},
		},
		baseline: {
			restore: async (subjectId) => {
				events.push("baseline-restore");
				if (subjectId === overrides.restoreFailsFor) {
					throw new Error("baseline implementation details");
				}
			},
		},
		audit: {
			append: async (auditRecord) => {
				events.push("redacted-audit");
				audit.push(auditRecord);
			},
		},
	});
	return {
		audit,
		bridge,
		control,
		dispatchRequests,
		events,
		signals,
		store,
		wal,
		resolveTerminal: (partial = {}) => {
			const request = dispatchRequests.at(-1);
			if (!request || !terminalResolver) {
				throw new Error("No pending test dispatch");
			}
			terminalResolver({
				leaseId: request.leaseId,
				activationGeneration: request.activationGeneration,
				outcome: "visible",
				humanVisible: true,
				...partial,
			});
		},
	};
}
