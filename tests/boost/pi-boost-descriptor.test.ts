import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	BOOST_LEASE_MODEL_KEY,
	boostDescriptorFingerprint,
	hasReviewedBoostModelBinding,
	normalizeBoostDescriptor,
	parseBoostDescriptor,
} from "../../extensions/pi-boost/boost-descriptor.js";
import type { BOOST_BASELINE_MODEL_KEY } from "../../extensions/pi-boost/boost-descriptor.js";
import { assertProperty } from "../lib/fast-check.js";

const NOW = 10_000;
const descriptor = {
	schemaVersion: 1,
	enablementId: "principal-boost",
	principalIssuerId: "principal",
	enabled: true,
	maximumYields: 3,
	expiresAt: 20_000,
	revision: 1,
	model: { key: "principalBoostLease", provider: "reviewed", id: "sol", family: "sol-ultra" },
};

function normalizedFixture() {
	const normalized = normalizeBoostDescriptor(descriptor, NOW);
	if (!normalized) throw new Error("Expected valid fixture");
	return normalized;
}

describe("Boost descriptor", () => {
	it("normalizes trimmed bounded fields and fingerprints the ADR-047 fixed-order JSON", () => {
		const normalized = normalizeBoostDescriptor({
			...descriptor, principalIssuerId: " principal ", model: { ...descriptor.model, provider: " reviewed ", id: " sol " },
		}, NOW);
		expect(normalized).toMatchObject({ principalIssuerId: "principal", model: { provider: "reviewed", id: "sol" } });
		expect(boostDescriptorFingerprint(normalizedFixture())).toBe("07e1b6363c00b0ff5d4e68e311694d4b2bc64a822b6e19c592bd64d17879f919");
		const canonical = JSON.stringify(descriptor);
		expect(boostDescriptorFingerprint(normalizedFixture())).toBe(createHash("sha256").update(canonical, "utf8").digest("hex"));
	});

	it.each([
		{ schemaVersion: 2 }, { enablementId: "contains spaces" }, { enablementId: "x".repeat(65) },
		{ principalIssuerId: " " }, { principalIssuerId: "é".repeat(129) }, { enabled: false },
		{ maximumYields: 0 }, { maximumYields: 4 }, { maximumYields: 1.5 }, { expiresAt: NOW },
		{ expiresAt: Number.POSITIVE_INFINITY }, { revision: -1 }, { revision: 1.5 },
		{ teamId: "forbidden" }, { thinkingLevel: "high" }, { endpoint: "forbidden" },
		{ model: { ...descriptor.model, key: "principalBoostBaseline" } },
		{ model: { ...descriptor.model, provider: " " } }, { model: { ...descriptor.model, family: "other" } },
	])("rejects invalid, unknown, and Team-shaped fields %#", (invalid) => {
		expect(normalizeBoostDescriptor({ ...descriptor, ...invalid }, NOW)).toBeUndefined();
	});

	it("requires exactly the descriptor and model fields", () => {
		expect(normalizeBoostDescriptor({ ...descriptor, model: { ...descriptor.model, extra: true } }, NOW)).toBeUndefined();
		expect(normalizeBoostDescriptor({ ...descriptor, model: { key: descriptor.model.key, provider: descriptor.model.provider, id: descriptor.model.id } }, NOW)).toBeUndefined();
		expect(parseBoostDescriptor("# boost", NOW)).toBeUndefined();
	});

	it("property: only safe integer yield and revision values satisfy their numeric bounds", () => {
		assertProperty(fc.property(fc.integer({ min: -10, max: 10 }), fc.integer({ min: -10, max: 10 }), (maximumYields, revision) => {
			const actual = normalizeBoostDescriptor({ ...descriptor, maximumYields, revision }, NOW);
			expect(actual !== undefined).toBe(maximumYields >= 1 && maximumYields <= 3 && revision >= 0);
		}));
	});

	it("requires the reviewed lease identity and unaltered reviewed baseline", () => {
		const modelResolver = {
			resolve(key: typeof BOOST_LEASE_MODEL_KEY | typeof BOOST_BASELINE_MODEL_KEY) {
				return key === BOOST_LEASE_MODEL_KEY
					? { provider: "reviewed", id: "sol", family: "sol-ultra" }
					: { provider: "baseline", id: "glm", family: "glm-5.2" };
			},
		};
		expect(hasReviewedBoostModelBinding(normalizedFixture(), modelResolver)).toBe(true);
		expect(hasReviewedBoostModelBinding(normalizedFixture(), { resolve: () => undefined })).toBe(false);
		expect(hasReviewedBoostModelBinding(normalizedFixture(), {
			resolve: (key) => key === BOOST_LEASE_MODEL_KEY
				? { provider: "other", id: "sol", family: "sol-ultra" }
				: { provider: "baseline", id: "glm", family: "other" },
		})).toBe(false);
	});
});
