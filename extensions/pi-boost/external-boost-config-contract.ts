/** Exact read-only Teams-shaped external Boost config boost control boundary. */

export const EXTERNAL_BOOST_TEAM_ID = "external-boost" as const;
export const EXTERNAL_BOOST_BASELINE_KEY = "principalBoostBaseline" as const;
export const EXTERNAL_BOOST_LEASE_KEY = "principalBoostLease" as const;

export interface ExternalBoostConfigReference {
	readonly teamId: typeof EXTERNAL_BOOST_TEAM_ID;
	readonly enablementId: string;
	readonly mappingVersion: number;
	readonly rollbackVersion: number;
	readonly baselineLogicalKey: typeof EXTERNAL_BOOST_BASELINE_KEY;
	readonly leaseLogicalKey: typeof EXTERNAL_BOOST_LEASE_KEY;
}

/** Verification statuses only; raw signatures and residency evidence are never exposed. */
export interface ExternalBoostConfigRecord {
	readonly schemaVersion: 2;
	readonly protocol: "boost";
	readonly teamId: typeof EXTERNAL_BOOST_TEAM_ID;
	readonly enablementId: string;
	readonly principalIssuerId: string;
	readonly mappingVersion: number;
	readonly rollbackVersion: number;
	readonly baselineLogicalKey: typeof EXTERNAL_BOOST_BASELINE_KEY;
	readonly leaseLogicalKey: typeof EXTERNAL_BOOST_LEASE_KEY;
	readonly maximumYields: number;
	readonly expiresAt: number;
	readonly revision: number;
	readonly enabled: boolean;
	readonly signatureStatus: "verified";
	readonly ownershipStatus: "principal-owned";
	readonly residencyEvidence: "external-eligible";
}

export interface ExternalBoostConfigRevision {
	readonly enablementId: string;
	readonly revision: number;
	readonly reason: "revision" | "revoked" | "expired" | "rollback";
}

export interface ExternalBoostConfigSubscription {
	unsubscribe(): void;
}

/** Read-only: no descriptor, enablement, mapping, or rollback mutation method exists. */
export interface ExternalBoostConfigAdapter {
	resolve(
		reference: ExternalBoostConfigReference,
	): Promise<ExternalBoostConfigRecord | undefined>;
	subscribe(
		reference: ExternalBoostConfigReference,
		listener: (revision: ExternalBoostConfigRevision) => Promise<void>,
	): ExternalBoostConfigSubscription | undefined;
}

export function validateExternalBoostConfig(
	reference: ExternalBoostConfigReference,
	record: ExternalBoostConfigRecord | undefined,
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
		record.teamId === EXTERNAL_BOOST_TEAM_ID &&
		reference.teamId === EXTERNAL_BOOST_TEAM_ID &&
		record.enablementId === reference.enablementId &&
		record.principalIssuerId === input.issuerId &&
		record.mappingVersion === reference.mappingVersion &&
		record.rollbackVersion === reference.rollbackVersion &&
		record.baselineLogicalKey === EXTERNAL_BOOST_BASELINE_KEY &&
		reference.baselineLogicalKey === EXTERNAL_BOOST_BASELINE_KEY &&
		record.leaseLogicalKey === EXTERNAL_BOOST_LEASE_KEY &&
		reference.leaseLogicalKey === EXTERNAL_BOOST_LEASE_KEY &&
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
