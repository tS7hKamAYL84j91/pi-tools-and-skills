/** Minimal read-only Teams-shaped external Boost configuration boundary. */

export const EXTERNAL_BOOST_TEAM_ID = "external-boost" as const;

export interface ExternalBoostConfigReference {
	readonly teamId: typeof EXTERNAL_BOOST_TEAM_ID;
	readonly enablementId: string;
}

/** Configuration may be published externally, but only pi-boost grants leases. */
export interface ExternalBoostConfigRecord {
	readonly schemaVersion: 1;
	readonly protocol: "boost";
	readonly teamId: typeof EXTERNAL_BOOST_TEAM_ID;
	readonly enablementId: string;
	readonly principalIssuerId: string;
	readonly maximumYields: number;
	readonly expiresAt: number;
	readonly revision: number;
	readonly enabled: boolean;
}

export interface ExternalBoostConfigRevision {
	readonly enablementId: string;
	readonly revision: number;
	readonly reason: "revision" | "revoked" | "expired" | "rollback";
}

export interface ExternalBoostConfigSubscription {
	unsubscribe(): void;
}

/** Read-only: no create, update, enablement, mapping, or rollback method exists. */
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
		record.schemaVersion === 1 &&
		record.protocol === "boost" &&
		record.teamId === EXTERNAL_BOOST_TEAM_ID &&
		reference.teamId === EXTERNAL_BOOST_TEAM_ID &&
		record.enablementId === reference.enablementId &&
		record.principalIssuerId === input.issuerId &&
		record.enabled === true &&
		Number.isSafeInteger(record.maximumYields) &&
		record.maximumYields >= input.requestedYields &&
		record.maximumYields <= 3 &&
		Number.isFinite(record.expiresAt) &&
		record.expiresAt > input.now
	);
}
