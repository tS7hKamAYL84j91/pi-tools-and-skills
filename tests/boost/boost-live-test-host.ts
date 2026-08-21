import {
	BOOST_LEASE_MAX_DURATION_MS,
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
import type {
	LiveBoostControlAdapter,
	LiveBoostControlRecord,
	LiveBoostControlReference,
	LiveBoostControlRevision,
	LiveBoostControlSubscription,
} from "../../extensions/pi-boost/live-boost-control-contract.js";
import type { BoostDescriptorAdapter } from "../../extensions/pi-boost/boost-descriptor-adapter.js";
import type {
	BoostDescriptorResolution,
	BoostThinkingLevel,
	ReviewedBoostThinkingPolicy,
} from "../../extensions/pi-boost/boost-descriptor.js";

export const TEST_CONTROL_REFERENCE: LiveBoostControlReference = {
	enablementId: "enablement-test",
};

export class TestDaemonWal implements DaemonBoostWal {
	readonly records: DaemonBoostWalRecord[] = [];
	readonly events?: string[];
	failNextAppend = false;
	readonly failActions = new Set<DaemonBoostWalRecord["action"]>();

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
		if (this.failNextAppend || this.failActions.has(record.action)) {
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

class TestLiveBoostControlAdapter implements LiveBoostControlAdapter {
	resolveCount = 0;
	record: LiveBoostControlRecord;
	streamAvailable = true;
	private readonly listeners = new Set<
		(revision: LiveBoostControlRevision) => Promise<void>
	>();

	constructor(record: LiveBoostControlRecord) {
		this.record = record;
	}

	async resolve(
		_reference: LiveBoostControlReference,
	): Promise<LiveBoostControlRecord | undefined> {
		this.resolveCount += 1;
		return this.record;
	}

	subscribe(
		_reference: LiveBoostControlReference,
		listener: (revision: LiveBoostControlRevision) => Promise<void>,
	): LiveBoostControlSubscription | undefined {
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

	async emit(reason: LiveBoostControlRevision["reason"]): Promise<void> {
		const revision: LiveBoostControlRevision = {
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
	readonly control: TestLiveBoostControlAdapter;
	readonly descriptor: { value: BoostDescriptorResolution };
	readonly dispatchRequests: LiveBoostProviderRequest[];
	readonly modelKeys: string[];
	readonly events: string[];
	readonly signals: AbortSignal[];
	readonly store: DaemonBoostControlStore;
	readonly wal: TestDaemonWal;
	resolveTerminal(event?: Partial<LiveBoostTerminalEvent>): void;
}

interface TestHostOverrides {
	readonly control?: Partial<LiveBoostControlRecord>;
	readonly now?: () => number;
	readonly restoreFailsFor?: string;
	readonly isolationFailsFor?: string;
	readonly auditFails?: boolean;
	readonly acknowledgeAbort?: boolean;
	readonly wal?: TestDaemonWal;
	readonly thinkingLevel?: BoostThinkingLevel;
	readonly thinkingPolicy?: () => ReviewedBoostThinkingPolicy | undefined;
}

export async function createLiveBoostTestHost(
	overrides: TestHostOverrides = {},
): Promise<LiveBoostTestHost> {
	const events = overrides.wal?.events ?? [];
	const wal = overrides.wal ?? new TestDaemonWal(events);
	const now = overrides.now ?? (() => 10_000);
	const store = await DaemonBoostControlStore.open(wal, now);
	const record: LiveBoostControlRecord = {
		enablementId: TEST_CONTROL_REFERENCE.enablementId,
		principalIssuerId: "principal-test",
		maximumYields: 3,
		expiresAt: now() + 2 * BOOST_LEASE_MAX_DURATION_MS,
		revision: 11,
		enabled: true,
		...overrides.control,
	};
	const control = new TestLiveBoostControlAdapter(record);
	const descriptor: { value: BoostDescriptorResolution } = { value: {
		descriptor: {
			schemaVersion: 1,
			enablementId: TEST_CONTROL_REFERENCE.enablementId,
			principalIssuerId: "principal-test",
			enabled: true,
			...(overrides.thinkingLevel === undefined ? {} : { thinkingLevel: overrides.thinkingLevel }),
			maximumYields: 3,
			expiresAt: now() + 2 * BOOST_LEASE_MAX_DURATION_MS,
			revision: 11,
			model: { key: "principalBoostLease", provider: "provider-test", id: "model-test", family: "sol-ultra" },
		},
		fingerprint: "test-fingerprint",
		source: "builtin",
		path: "/test/boost.md",
	} };
	const descriptorAdapter: BoostDescriptorAdapter = { resolve: async () => descriptor.value };
	const audit: LiveBoostAuditRecord[] = [];
	const modelKeys: string[] = [];
	const dispatchRequests: LiveBoostProviderRequest[] = [];
	const signals: AbortSignal[] = [];
	let terminalResolver: ((event: LiveBoostTerminalEvent) => void) | undefined;
	const bridge = new HostInjectedLiveBoostRuntime({
		store,
		control,
		descriptor: descriptorAdapter,
		models: {
			resolve: (key) => {
				modelKeys.push(key);
				return key === "principalBoostLease"
				? { provider: "provider-test", id: "model-test", family: "sol-ultra" }
				: { provider: "baseline-test", id: "baseline-test", family: "glm-5.2" };
			},
		},
		thinkingPolicy: {
			resolve: () => overrides.thinkingPolicy?.() ?? ({ policyRevision: 1, defaultLevel: "medium", supportedLevels: ["low", "medium", "high"] }),
		},
		now,
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
							if (overrides.acknowledgeAbort !== false) {
								terminalResolver?.({
									leaseId: request.leaseId,
									activationGeneration: request.activationGeneration,
									outcome: "cancelled",
									humanVisible: false,
								});
							}
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
		isolation: { dispose: async (subjectId) => {
			events.push("isolation-dispose");
			if (subjectId === overrides.isolationFailsFor) {
				throw new Error("isolation implementation details");
			}
		} },
		audit: {
			append: async (auditRecord) => {
				events.push("redacted-audit");
				if (overrides.auditFails) {
					throw new Error("audit implementation details");
				}
				audit.push(auditRecord);
			},
		},
	});
	return {
		audit,
		bridge,
		control,
		descriptor,
		dispatchRequests,
		modelKeys,
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
