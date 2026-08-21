import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
	boostDescriptorFingerprint,
	normalizeBoostDescriptor,
} from "../../extensions/pi-boost/boost-descriptor.js";
import type { BoostDescriptor } from "../../extensions/pi-boost/boost-descriptor.js";
import { assertProperty } from "../lib/fast-check.js";

const idArbitrary = fc.array(fc.constantFrom("a", "B", "0", "_", "-"), { minLength: 1, maxLength: 12 })
	.map((parts) => parts.join(""));

function descriptor(enablementId: string, provider: string, id: string, revision: number): BoostDescriptor {
	return {
		schemaVersion: 1,
		enablementId,
		principalIssuerId: "principal",
		enabled: true,
		maximumYields: 2,
		expiresAt: 2_000,
		revision,
		model: { key: "principalBoostLease", provider, id, family: "sol-ultra" },
	};
}

describe("bounded Boost descriptor properties", () => {
	it("normalizes JSON-stable descriptors and fingerprints them deterministically", () => {
		assertProperty(fc.property(idArbitrary, idArbitrary, idArbitrary, fc.nat({ max: 100 }), (enablementId, provider, id, revision) => {
			const value = descriptor(enablementId, provider, id, revision);
			const normalized = normalizeBoostDescriptor(JSON.parse(JSON.stringify(value)), 1_000);
			expect(normalized).toEqual(value);
			if (normalized === undefined) {
				throw new Error("generated descriptor did not normalize");
			}
			expect(boostDescriptorFingerprint(value)).toBe(boostDescriptorFingerprint(normalized));
			expect(boostDescriptorFingerprint({ ...value, revision: revision + 1 })).not.toBe(boostDescriptorFingerprint(value));
		}));
	});
});
