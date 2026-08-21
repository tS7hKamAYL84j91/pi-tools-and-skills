/** Strict read-only adapter from an injected external Boost config record source to the boost contract. */

import type {
	ExternalBoostConfigAdapter,
	ExternalBoostConfigRecord,
	ExternalBoostConfigReference,
	ExternalBoostConfigRevision,
	ExternalBoostConfigSubscription,
} from "./external-boost-config-contract.js";
import { EXTERNAL_BOOST_TEAM_ID } from "./external-boost-config-contract.js";

/** @public Read-only external Boost config source; it intentionally exposes no control mutation. */
export interface ExternalBoostConfigRecordSource {
	resolve(enablementId: string): Promise<ExternalBoostConfigRecord | undefined>;
	subscribe(
		listener: (revision: ExternalBoostConfigRevision) => Promise<void>,
	): ExternalBoostConfigSubscription;
}

/** @public Fixed trusted identity and clock used to validate external records. */
export interface ExternalBoostConfigAdapterOptions {
	readonly principalIssuerId: string;
	readonly now: () => number;
}

/** Creates a fail-closed adapter over an injected read-only record source. */
export function createExternalBoostConfigAdapter(
	source: ExternalBoostConfigRecordSource,
	options: ExternalBoostConfigAdapterOptions,
): ExternalBoostConfigAdapter {
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
			let sourceSubscription: ExternalBoostConfigSubscription;
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
	reference: ExternalBoostConfigReference | undefined,
): reference is ExternalBoostConfigReference {
	return (
		reference != null &&
		reference.teamId === EXTERNAL_BOOST_TEAM_ID &&
		isOpaqueIdentifier(reference.enablementId)
	);
}

function isValidRecord(
	record: ExternalBoostConfigRecord | undefined,
	reference: ExternalBoostConfigReference,
	options: ExternalBoostConfigAdapterOptions,
): record is ExternalBoostConfigRecord {
	return (
		record !== undefined &&
		record.schemaVersion === 1 &&
		record.protocol === "boost" &&
		record.teamId === EXTERNAL_BOOST_TEAM_ID &&
		record.enablementId === reference.enablementId &&
		record.principalIssuerId === options.principalIssuerId &&
		Number.isSafeInteger(record.maximumYields) &&
		record.maximumYields >= 1 &&
		record.maximumYields <= 3 &&
		isRevision(record.revision) &&
		record.enabled === true &&
		Number.isFinite(record.expiresAt) &&
		record.expiresAt > options.now()
	);
}

function isOpaqueIdentifier(value: string): boolean {
	return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function isRevision(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}
