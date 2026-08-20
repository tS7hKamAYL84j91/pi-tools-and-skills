import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	createQBoostControlAdapter,
	type QBoostControlRecordSource,
} from "../../extensions/pi-boost/q-boost-control-adapter.js";
import {
	Q_BOOST_BASELINE_KEY,
	Q_BOOST_LEASE_KEY,
	Q_BOOST_TEAM_ID,
	type QBoostControlRecord,
	type QBoostControlReference,
	type QBoostControlRevision,
} from "../../extensions/pi-boost/q-boost-control-contract.js";

const REFERENCE: QBoostControlReference = {
	teamId: Q_BOOST_TEAM_ID,
	enablementId: "enablement-test",
	mappingVersion: 7,
	rollbackVersion: 3,
	baselineLogicalKey: Q_BOOST_BASELINE_KEY,
	leaseLogicalKey: Q_BOOST_LEASE_KEY,
};

function record(overrides: Record<string, unknown> = {}): QBoostControlRecord {
	const canonical: QBoostControlRecord = {
		schemaVersion: 2,
		protocol: "boost",
		teamId: Q_BOOST_TEAM_ID,
		enablementId: REFERENCE.enablementId,
		principalIssuerId: "principal-test",
		mappingVersion: REFERENCE.mappingVersion,
		rollbackVersion: REFERENCE.rollbackVersion,
		baselineLogicalKey: Q_BOOST_BASELINE_KEY,
		leaseLogicalKey: Q_BOOST_LEASE_KEY,
		maximumYields: 3,
		expiresAt: 20_000,
		revision: 4,
		enabled: true,
		signatureStatus: "verified",
		ownershipStatus: "principal-owned",
		residencyEvidence: "external-eligible",
	};
	// Intentional malformed runtime record fixture for fail-closed validation.
	return { ...canonical, ...overrides } as QBoostControlRecord;
}

function createSource(initial: QBoostControlRecord | undefined): {
	readonly source: QBoostControlRecordSource;
	readonly calls: { resolve: number; unsubscribe: number };
	emit(revision: QBoostControlRevision): Promise<void>;
} {
	const listeners = new Set<
		(revision: QBoostControlRevision) => Promise<void>
	>();
	const calls = { resolve: 0, unsubscribe: 0 };
	return {
		source: {
			resolve: async () => {
				calls.resolve += 1;
				return initial;
			},
			subscribe: (listener) => {
				listeners.add(listener);
				return {
					unsubscribe: () => {
						calls.unsubscribe += 1;
						listeners.delete(listener);
					},
				};
			},
		},
		calls,
		emit: async (revision) => {
			for (const listener of listeners) {
				await listener(revision);
			}
		},
	};
}

function createAdapter(initial: QBoostControlRecord | undefined) {
	const fixture = createSource(initial);
	return {
		fixture,
		adapter: createQBoostControlAdapter(fixture.source, {
			principalIssuerId: "principal-test",
			now: () => 10_000,
		}),
	};
}

describe("Q boost control adapter", () => {
	it("resolves only a current canonical Q record", async () => {
		const { adapter } = createAdapter(record());

		expect(await adapter.resolve(REFERENCE)).toEqual(record());
	});

	it.each([
		{ enabled: false },
		{ expiresAt: 10_000 },
		{ mappingVersion: 8 },
		{ rollbackVersion: 4 },
		{ principalIssuerId: "other-principal" },
		{ maximumYields: 4 },
		{ revision: -1 },
		{ signatureStatus: "unverified" },
		{ ownershipStatus: "other" },
		{ residencyEvidence: "local-only" },
	] as const)("fails closed for invalid Q record %#", async (overrides) => {
		const { adapter } = createAdapter(record(overrides));

		expect(await adapter.resolve(REFERENCE)).toBeUndefined();
	});

	it.each([
		undefined,
		null,
	])("fails closed for absent references before consulting Q", async (absent) => {
		const { adapter, fixture } = createAdapter(record());
		const malformed = absent as unknown as QBoostControlReference;

		expect(await adapter.resolve(malformed)).toBeUndefined();
		expect(adapter.subscribe(malformed, async () => undefined)).toBeUndefined();
		expect(fixture.calls.resolve).toBe(0);
	});

	it("rejects a malformed reference before consulting Q", async () => {
		const { adapter, fixture } = createAdapter(record());
		const malformed = {
			...REFERENCE,
			mappingVersion: -1,
		} as QBoostControlReference;

		expect(await adapter.resolve(malformed)).toBeUndefined();
		expect(adapter.subscribe(malformed, async () => undefined)).toBeUndefined();
		expect(fixture.calls.resolve).toBe(0);
	});

	it("rejects a string-coerced reference before consulting Q", async () => {
		const { adapter, fixture } = createAdapter(record());
		const malformed = {
			...REFERENCE,
			mappingVersion: "7",
		} as unknown as QBoostControlReference;

		expect(await adapter.resolve(malformed)).toBeUndefined();
		expect(fixture.calls.resolve).toBe(0);
	});

	it("fails closed when the injected Q source throws", async () => {
		const source: QBoostControlRecordSource = {
			resolve: async () => {
				throw new Error("Q unavailable");
			},
			subscribe: () => {
				throw new Error("Q unavailable");
			},
		};
		const adapter = createQBoostControlAdapter(source, {
			principalIssuerId: "principal-test",
			now: () => 10_000,
		});

		expect(await adapter.resolve(REFERENCE)).toBeUndefined();
		expect(adapter.subscribe(REFERENCE, async () => undefined)).toBeUndefined();
	});

	it("filters mismatched and stale revisions with idempotent unsubscribe", async () => {
		const { adapter, fixture } = createAdapter(record());
		const delivered: QBoostControlRevision[] = [];
		const subscription = adapter.subscribe(REFERENCE, async (revision) => {
			delivered.push(revision);
		});
		if (!subscription) {
			throw new Error("Expected valid subscription");
		}

		await fixture.emit({
			enablementId: "other-enablement",
			revision: 10,
			reason: "revoked",
		});
		await fixture.emit({
			enablementId: REFERENCE.enablementId,
			revision: 3,
			reason: "revision",
		});
		await fixture.emit({
			enablementId: REFERENCE.enablementId,
			revision: 3,
			reason: "rollback",
		});
		await fixture.emit({
			enablementId: REFERENCE.enablementId,
			revision: 4,
			reason: "revoked",
		});
		subscription.unsubscribe();
		subscription.unsubscribe();
		await fixture.emit({
			enablementId: REFERENCE.enablementId,
			revision: 5,
			reason: "expired",
		});

		expect(delivered).toEqual([
			{
				enablementId: REFERENCE.enablementId,
				revision: 3,
				reason: "revision",
			},
			{
				enablementId: REFERENCE.enablementId,
				revision: 4,
				reason: "revoked",
			},
		]);
		expect(fixture.calls.unsubscribe).toBe(1);
	});

	it("exposes no provider, configuration, scheduler, or raw-control seam", () => {
		const source = readFileSync(
			"extensions/pi-boost/q-boost-control-adapter.ts",
			"utf8",
		);
		expect(source).not.toMatch(
			/provider|configPath|defaultModel|scheduler|credential|rawSignature|residencyDocument/i,
		);
	});
});
