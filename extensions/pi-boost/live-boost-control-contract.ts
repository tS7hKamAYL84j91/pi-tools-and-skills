/** Read-only injected live-control gate; it has no Team semantics or model authority. */

export interface LiveBoostControlReference {
	readonly enablementId: string;
}

export interface LiveBoostControlRecord {
	readonly enablementId: string;
	readonly principalIssuerId: string;
	readonly maximumYields: number;
	readonly expiresAt: number;
	readonly revision: number;
	readonly enabled: boolean;
}

export interface LiveBoostControlRevision {
	readonly enablementId: string;
	readonly revision: number;
	readonly reason: "revision" | "revoked" | "expired" | "rollback";
}

export interface LiveBoostControlSubscription {
	unsubscribe(): void;
}

/** Live control can only gate/revoke an already-valid descriptor. */
export interface LiveBoostControlAdapter {
	resolve(
		reference: LiveBoostControlReference,
	): Promise<LiveBoostControlRecord | undefined>;
	subscribe(
		reference: LiveBoostControlReference,
		listener: (revision: LiveBoostControlRevision) => Promise<void>,
	): LiveBoostControlSubscription | undefined;
}

export function validateLiveBoostControl(
	reference: LiveBoostControlReference,
	record: LiveBoostControlRecord | undefined,
	input: {
		readonly issuerId: string;
		readonly requestedYields: number;
		readonly now: number;
	},
): boolean {
	return (
		hasLiveBoostControlFields(record) &&
		isReference(reference) &&
		record.enablementId === reference.enablementId &&
		record.principalIssuerId === input.issuerId &&
		record.enabled === true &&
		Number.isSafeInteger(record.maximumYields) &&
		record.maximumYields >= input.requestedYields &&
		record.maximumYields <= 3 &&
		Number.isSafeInteger(record.revision) &&
		record.revision >= 0 &&
		Number.isFinite(record.expiresAt) &&
		record.expiresAt > input.now
	);
}

function hasLiveBoostControlFields(
	value: unknown,
): value is LiveBoostControlRecord {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		hasExactKeys(value as Record<string, unknown>, [
			"enablementId",
			"principalIssuerId",
			"maximumYields",
			"expiresAt",
			"revision",
			"enabled",
		])
	);
}

function hasExactKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	const actual = Object.keys(value);
	return (
		actual.length === keys.length && actual.every((key) => keys.includes(key))
	);
}

function isReference(reference: LiveBoostControlReference): boolean {
	return isOpaqueIdentifier(reference.enablementId);
}

function isOpaqueIdentifier(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
