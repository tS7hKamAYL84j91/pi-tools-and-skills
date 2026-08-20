/** Exact read-only Q schema-v2 boost control boundary. */

export const Q_BOOST_TEAM_ID = "q-boost" as const;
export const Q_BOOST_BASELINE_KEY = "principalBoostBaseline" as const;
export const Q_BOOST_LEASE_KEY = "principalBoostLease" as const;

export interface QBoostControlReference {
	readonly teamId: typeof Q_BOOST_TEAM_ID;
	readonly enablementId: string;
	readonly mappingVersion: number;
	readonly rollbackVersion: number;
	readonly baselineLogicalKey: typeof Q_BOOST_BASELINE_KEY;
	readonly leaseLogicalKey: typeof Q_BOOST_LEASE_KEY;
}

/** Verification statuses only; raw signatures and residency evidence are never exposed. */
export interface QBoostControlRecord {
	readonly schemaVersion: 2;
	readonly protocol: "boost";
	readonly teamId: typeof Q_BOOST_TEAM_ID;
	readonly enablementId: string;
	readonly principalIssuerId: string;
	readonly mappingVersion: number;
	readonly rollbackVersion: number;
	readonly baselineLogicalKey: typeof Q_BOOST_BASELINE_KEY;
	readonly leaseLogicalKey: typeof Q_BOOST_LEASE_KEY;
	readonly maximumYields: number;
	readonly expiresAt: number;
	readonly revision: number;
	readonly enabled: boolean;
	readonly signatureStatus: "verified";
	readonly ownershipStatus: "principal-owned";
	readonly residencyEvidence: "external-eligible";
}

export interface QBoostControlRevision {
	readonly enablementId: string;
	readonly revision: number;
	readonly reason: "revision" | "revoked" | "expired" | "rollback";
}

export interface QBoostControlSubscription {
	unsubscribe(): void;
}

/** Read-only: no descriptor, enablement, mapping, or rollback mutation method exists. */
export interface QBoostControlAdapter {
	resolve(
		reference: QBoostControlReference,
	): Promise<QBoostControlRecord | undefined>;
	subscribe(
		reference: QBoostControlReference,
		listener: (revision: QBoostControlRevision) => Promise<void>,
	): QBoostControlSubscription | undefined;
}

export function validateQBoostControl(
	reference: QBoostControlReference,
	record: QBoostControlRecord | undefined,
	input: {
		readonly issuerId: string;
		readonly requestedYields: number;
		readonly now: number;
	},
): boolean {
	return (
		record !== undefined &&
		record.schemaVersion === 2 &&
		record.protocol === "boost" &&
		record.teamId === Q_BOOST_TEAM_ID &&
		reference.teamId === Q_BOOST_TEAM_ID &&
		record.enablementId === reference.enablementId &&
		record.principalIssuerId === input.issuerId &&
		record.mappingVersion === reference.mappingVersion &&
		record.rollbackVersion === reference.rollbackVersion &&
		record.baselineLogicalKey === Q_BOOST_BASELINE_KEY &&
		reference.baselineLogicalKey === Q_BOOST_BASELINE_KEY &&
		record.leaseLogicalKey === Q_BOOST_LEASE_KEY &&
		reference.leaseLogicalKey === Q_BOOST_LEASE_KEY &&
		record.enabled === true &&
		record.signatureStatus === "verified" &&
		record.ownershipStatus === "principal-owned" &&
		record.residencyEvidence === "external-eligible" &&
		Number.isSafeInteger(record.maximumYields) &&
		record.maximumYields >= input.requestedYields &&
		record.maximumYields <= 3 &&
		Number.isFinite(record.expiresAt) &&
		record.expiresAt > input.now
	);
}
