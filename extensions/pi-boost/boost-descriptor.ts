/** Fixed Boost descriptor schema, normalization, and reviewed model binding. */

import { createHash } from "node:crypto";

export const BOOST_LEASE_MODEL_KEY = "principalBoostLease" as const;
export const BOOST_BASELINE_MODEL_KEY = "principalBoostBaseline" as const;
export const BOOST_THINKING_LEVELS = ["low", "medium", "high"] as const;

export type BoostThinkingLevel = (typeof BOOST_THINKING_LEVELS)[number];

export interface ReviewedBoostThinkingPolicy {
	readonly policyRevision: number;
	readonly defaultLevel: BoostThinkingLevel;
	readonly supportedLevels: readonly BoostThinkingLevel[];
}

export interface ReviewedBoostThinkingPolicyResolver {
	resolve(): ReviewedBoostThinkingPolicy | undefined;
}

export interface ResolvedBoostThinking {
	readonly thinkingLevel: BoostThinkingLevel;
	readonly policyRevision: number;
}

export interface BoostModelDescriptor {
	readonly key: typeof BOOST_LEASE_MODEL_KEY;
	readonly provider: string;
	readonly id: string;
	readonly family: "sol-ultra";
}

export interface BoostDescriptor {
	readonly schemaVersion: 1;
	readonly enablementId: string;
	readonly principalIssuerId: string;
	readonly enabled: true;
	readonly maximumYields: number;
	readonly expiresAt: number;
	readonly revision: number;
	readonly model: BoostModelDescriptor;
}

export interface BoostDescriptorResolution {
	readonly descriptor: BoostDescriptor;
	readonly fingerprint: string;
	readonly source: "builtin" | "user" | "project";
	readonly path: string;
}

export interface ReviewedBoostModel {
	readonly provider: string;
	readonly id: string;
	readonly family: string;
}

export interface ReviewedBoostModelResolver {
	resolve(key: typeof BOOST_LEASE_MODEL_KEY | typeof BOOST_BASELINE_MODEL_KEY): ReviewedBoostModel | undefined;
}

/** Parses JSON contained directly in the fixed Markdown descriptor. */
export function parseBoostDescriptor(raw: string, now: number): BoostDescriptor | undefined {
	try {
		return normalizeBoostDescriptor(JSON.parse(raw) as unknown, now);
	} catch {
		return undefined;
	}
}

/** Validates a data-only descriptor and returns its canonical normalized form. */
export function normalizeBoostDescriptor(value: unknown, now: number): BoostDescriptor | undefined {
	if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "enablementId", "principalIssuerId", "enabled", "maximumYields", "expiresAt", "revision", "model"])) {
		return undefined;
	}
	const model = value.model;
	if (!isRecord(model) || !hasExactKeys(model, ["key", "provider", "id", "family"])) {
		return undefined;
	}
	const enablementId = value.enablementId;
	const principalIssuerId = trimBounded(value.principalIssuerId, 256);
	const provider = trimBounded(model.provider, 128);
	const id = trimBounded(model.id, 128);
	const maximumYields = value.maximumYields;
	const expiresAt = value.expiresAt;
	const revision = value.revision;
	if (
		value.schemaVersion !== 1 ||
		typeof enablementId !== "string" ||
		!/^[A-Za-z0-9_-]{1,64}$/.test(enablementId) ||
		!principalIssuerId ||
		value.enabled !== true ||
		typeof maximumYields !== "number" || !Number.isSafeInteger(maximumYields) || maximumYields < 1 || maximumYields > 3 ||
		typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= now ||
		typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 ||
		model.key !== BOOST_LEASE_MODEL_KEY || !provider || !id || model.family !== "sol-ultra"
	) {
		return undefined;
	}
	return {
		schemaVersion: 1,
		enablementId,
		principalIssuerId,
		enabled: true,
		maximumYields,
		expiresAt,
		revision,
		model: { key: BOOST_LEASE_MODEL_KEY, provider, id, family: "sol-ultra" },
	};
}

/** SHA-256 of the ADR-047 fixed-order whitespace-free JSON serialization. */
export function boostDescriptorFingerprint(descriptor: BoostDescriptor): string {
	const canonical = JSON.stringify({
		schemaVersion: descriptor.schemaVersion,
		enablementId: descriptor.enablementId,
		principalIssuerId: descriptor.principalIssuerId,
		enabled: descriptor.enabled,
		maximumYields: descriptor.maximumYields,
		expiresAt: descriptor.expiresAt,
		revision: descriptor.revision,
		model: {
			key: descriptor.model.key,
			provider: descriptor.model.provider,
			id: descriptor.model.id,
			family: descriptor.model.family,
		},
	});
	return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Resolves the host-owned policy; ADR-047 descriptors cannot select a level. */
export function resolveBoostThinking(
	_descriptor: BoostDescriptor,
	resolver: ReviewedBoostThinkingPolicyResolver,
): ResolvedBoostThinking | undefined {
	try {
		const policy = resolver.resolve();
		if (!isValidThinkingPolicy(policy)) return undefined;
		return { thinkingLevel: policy.defaultLevel, policyRevision: policy.policyRevision };
	} catch {
		return undefined;
	}
}

/** Ensures the descriptor cannot route around the reviewed host registry. */
export function hasReviewedBoostModelBinding(
	descriptor: BoostDescriptor,
	resolver: ReviewedBoostModelResolver,
): boolean {
	const lease = resolver.resolve(BOOST_LEASE_MODEL_KEY);
	const baseline = resolver.resolve(BOOST_BASELINE_MODEL_KEY);
	return lease?.provider === descriptor.model.provider && lease.id === descriptor.model.id &&
		lease.family === descriptor.model.family && baseline?.family === "glm-5.2";
}

function trimBounded(value: unknown, maximumBytes: number): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 && Buffer.byteLength(trimmed, "utf8") <= maximumBytes ? trimmed : undefined;
}

function hasExactKeys(
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[] = [],
): boolean {
	const actual = Object.keys(value);
	return actual.length >= required.length && actual.length <= required.length + optional.length &&
		actual.every((key) => required.includes(key) || optional.includes(key)) &&
		required.every((key) => actual.includes(key));
}

function isBoostThinkingLevel(value: unknown): value is BoostThinkingLevel {
	return typeof value === "string" && (BOOST_THINKING_LEVELS as readonly string[]).includes(value);
}

function isValidThinkingPolicy(
	policy: ReviewedBoostThinkingPolicy | undefined,
): policy is ReviewedBoostThinkingPolicy {
	return policy !== undefined && Number.isSafeInteger(policy.policyRevision) && policy.policyRevision >= 0 &&
		isBoostThinkingLevel(policy.defaultLevel) && policy.supportedLevels.length > 0 &&
		policy.supportedLevels.every(isBoostThinkingLevel) &&
		new Set(policy.supportedLevels).size === policy.supportedLevels.length &&
		policy.supportedLevels.includes(policy.defaultLevel);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
