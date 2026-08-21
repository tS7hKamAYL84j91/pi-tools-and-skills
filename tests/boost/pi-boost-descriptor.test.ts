import { describe, expect, it } from "vitest";
import {
	boostDescriptorFingerprint,
	normalizeBoostDescriptor,
	parseBoostDescriptor,
} from "../../extensions/pi-boost/boost-descriptor.js";

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

describe("Boost descriptor", () => {
	it("normalizes bounded fields and fingerprints fixed-order canonical JSON", () => {
		const normalized = normalizeBoostDescriptor(descriptor, NOW);
		if (!normalized) throw new Error("Expected valid fixture");
		expect(normalized.model.provider).toBe("reviewed");
		expect(boostDescriptorFingerprint(normalized)).toBe("07e1b6363c00b0ff5d4e68e311694d4b2bc64a822b6e19c592bd64d17879f919");
	});

	it.each([
		{ enabled: false }, { maximumYields: 4 }, { expiresAt: NOW }, { revision: -1 },
		{ teamId: "forbidden" }, { model: { ...descriptor.model, provider: " " } },
	])("fails closed for invalid or Team-shaped descriptors %#", (invalid) => {
		expect(normalizeBoostDescriptor({ ...descriptor, ...invalid }, NOW)).toBeUndefined();
	});

	it("does not parse malformed descriptor text", () => {
		expect(parseBoostDescriptor("# boost", NOW)).toBeUndefined();
	});
});
