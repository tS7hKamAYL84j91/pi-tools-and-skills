import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	createLiveBoostControlAdapter,
	type LiveBoostControlRecordSource,
} from "../../extensions/pi-boost/live-boost-control-adapter.js";
import type {
		LiveBoostControlRecord,
	LiveBoostControlReference,
	LiveBoostControlRevision,
} from "../../extensions/pi-boost/live-boost-control-contract.js";

const REFERENCE: LiveBoostControlReference = {
	enablementId: "enablement-test",
};

function record(overrides: Record<string, unknown> = {}): LiveBoostControlRecord {
	const canonical: LiveBoostControlRecord = {
			enablementId: REFERENCE.enablementId,
		principalIssuerId: "principal-test",
		maximumYields: 3,
		expiresAt: 20_000,
		revision: 4,
		enabled: true,
	};
	// Intentional malformed runtime record fixture for fail-closed validation.
	return { ...canonical, ...overrides } as LiveBoostControlRecord;
}

function createSource(initial: LiveBoostControlRecord | undefined): {
	readonly source: LiveBoostControlRecordSource;
	readonly calls: { resolve: number; unsubscribe: number };
	emit(revision: LiveBoostControlRevision): Promise<void>;
} {
	const listeners = new Set<
		(revision: LiveBoostControlRevision) => Promise<void>
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

function createAdapter(initial: LiveBoostControlRecord | undefined) {
	const fixture = createSource(initial);
	return {
		fixture,
		adapter: createLiveBoostControlAdapter(fixture.source, {
			principalIssuerId: "principal-test",
			now: () => 10_000,
		}),
	};
}

describe("external Boost config adapter", () => {
	it("resolves only a current canonical external Boost config record", async () => {
		const { adapter } = createAdapter(record());

		expect(await adapter.resolve(REFERENCE)).toEqual(record());
	});

	it.each([
		{ enabled: false },
		{ expiresAt: 10_000 },
		{ schemaVersion: 2 },
		{ teamId: "other-team" },
		{ enablementId: "other-enablement" },
		{ principalIssuerId: "other-principal" },
		{ maximumYields: 4 },
		{ revision: -1 },
	] as const)("fails closed for invalid external Boost config record %#", async (overrides) => {
		const { adapter } = createAdapter(record(overrides));

		expect(await adapter.resolve(REFERENCE)).toBeUndefined();
	});

	it.each([
		undefined,
		null,
	])("fails closed for absent references before consulting the source", async (absent) => {
		const { adapter, fixture } = createAdapter(record());
		const malformed = absent as unknown as LiveBoostControlReference;

		expect(await adapter.resolve(malformed)).toBeUndefined();
		expect(adapter.subscribe(malformed, async () => undefined)).toBeUndefined();
		expect(fixture.calls.resolve).toBe(0);
	});

	it("rejects a malformed reference before consulting the source", async () => {
		const { adapter, fixture } = createAdapter(record());
		const malformed = {
			...REFERENCE,
			enablementId: "invalid/value",
		} as LiveBoostControlReference;

		expect(await adapter.resolve(malformed)).toBeUndefined();
		expect(adapter.subscribe(malformed, async () => undefined)).toBeUndefined();
		expect(fixture.calls.resolve).toBe(0);
	});

	it("rejects a string-coerced reference before consulting the source", async () => {
		const { adapter, fixture } = createAdapter(record());
		const malformed = {
			...REFERENCE,
			teamId: 7,
		} as unknown as LiveBoostControlReference;

		expect(await adapter.resolve(malformed)).toBeUndefined();
		expect(fixture.calls.resolve).toBe(0);
	});

	it("fails closed when the injected external Boost config source throws", async () => {
		const source: LiveBoostControlRecordSource = {
			resolve: async () => {
				throw new Error("external config unavailable");
			},
			subscribe: () => {
				throw new Error("external config unavailable");
			},
		};
		const adapter = createLiveBoostControlAdapter(source, {
			principalIssuerId: "principal-test",
			now: () => 10_000,
		});

		expect(await adapter.resolve(REFERENCE)).toBeUndefined();
		expect(adapter.subscribe(REFERENCE, async () => undefined)).toBeUndefined();
	});

	it("filters mismatched and stale revisions with idempotent unsubscribe", async () => {
		const { adapter, fixture } = createAdapter(record());
		const delivered: LiveBoostControlRevision[] = [];
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
			"extensions/pi-boost/live-boost-control-adapter.ts",
			"utf8",
		);
		expect(source).not.toMatch(
			/provider|configPath|defaultModel|scheduler|credential|rawSignature|residencyDocument/i,
		);
	});
});
