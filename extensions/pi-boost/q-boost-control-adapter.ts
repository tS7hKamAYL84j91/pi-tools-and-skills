/** Strict read-only adapter from an injected Q record source to the boost contract. */

import type {
	QBoostControlAdapter,
	QBoostControlRecord,
	QBoostControlReference,
	QBoostControlRevision,
	QBoostControlSubscription,
} from "./q-boost-control-contract.js";
import {
	Q_BOOST_BASELINE_KEY,
	Q_BOOST_LEASE_KEY,
	Q_BOOST_TEAM_ID,
} from "./q-boost-control-contract.js";

/** @public Read-only Q source; it intentionally exposes no control mutation. */
export interface QBoostControlRecordSource {
	resolve(enablementId: string): Promise<QBoostControlRecord | undefined>;
	subscribe(
		listener: (revision: QBoostControlRevision) => Promise<void>,
	): QBoostControlSubscription;
}

/** @public Fixed trusted identity and clock used to validate Q records. */
export interface QBoostControlAdapterOptions {
	readonly principalIssuerId: string;
	readonly now: () => number;
}

/** Creates a fail-closed adapter over a Q-injected read-only record source. */
export function createQBoostControlAdapter(
	source: QBoostControlRecordSource,
	options: QBoostControlAdapterOptions,
): QBoostControlAdapter {
	return {
		resolve: async (reference) => {
			if (!isValidReference(reference)) {
				return undefined;
			}
			try {
				const record = await source.resolve(reference.enablementId);
				return isValidRecord(record, reference, options) ? record : undefined;
			} catch {
				return undefined;
			}
		},
		subscribe: (reference, listener) => {
			if (!isValidReference(reference)) {
				return undefined;
			}
			let active = true;
			let latestRevision = -1;
			let sourceSubscription: QBoostControlSubscription;
			try {
				sourceSubscription = source.subscribe(async (revision) => {
					if (
						!active ||
						revision.enablementId !== reference.enablementId ||
						!isRevision(revision.revision) ||
						revision.revision <= latestRevision
					) {
						return;
					}
					latestRevision = revision.revision;
					await listener(revision);
				});
			} catch {
				return undefined;
			}
			return {
				unsubscribe: () => {
					if (!active) {
						return;
					}
					active = false;
					sourceSubscription.unsubscribe();
				},
			};
		},
	};
}

function isValidReference(
	reference: QBoostControlReference | undefined,
): reference is QBoostControlReference {
	return (
		reference != null &&
		reference.teamId === Q_BOOST_TEAM_ID &&
		reference.baselineLogicalKey === Q_BOOST_BASELINE_KEY &&
		reference.leaseLogicalKey === Q_BOOST_LEASE_KEY &&
		isOpaqueIdentifier(reference.enablementId) &&
		isVersion(reference.mappingVersion) &&
		isVersion(reference.rollbackVersion)
	);
}

function isValidRecord(
	record: QBoostControlRecord | undefined,
	reference: QBoostControlReference,
	options: QBoostControlAdapterOptions,
): record is QBoostControlRecord {
	return (
		record !== undefined &&
		record.schemaVersion === 2 &&
		record.protocol === "boost" &&
		record.teamId === Q_BOOST_TEAM_ID &&
		record.enablementId === reference.enablementId &&
		record.principalIssuerId === options.principalIssuerId &&
		record.mappingVersion === reference.mappingVersion &&
		record.rollbackVersion === reference.rollbackVersion &&
		record.baselineLogicalKey === Q_BOOST_BASELINE_KEY &&
		record.leaseLogicalKey === Q_BOOST_LEASE_KEY &&
		Number.isSafeInteger(record.maximumYields) &&
		record.maximumYields >= 1 &&
		record.maximumYields <= 3 &&
		isRevision(record.revision) &&
		record.enabled === true &&
		record.signatureStatus === "verified" &&
		record.ownershipStatus === "principal-owned" &&
		record.residencyEvidence === "external-eligible" &&
		Number.isFinite(record.expiresAt) &&
		record.expiresAt > options.now()
	);
}

function isOpaqueIdentifier(value: string): boolean {
	return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function isVersion(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}

function isRevision(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}
