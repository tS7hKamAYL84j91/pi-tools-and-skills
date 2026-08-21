/** Strict adapter from an injected live-control source to the Boost gate contract. */

import type {
	LiveBoostControlAdapter,
	LiveBoostControlRecord,
	LiveBoostControlReference,
	LiveBoostControlRevision,
	LiveBoostControlSubscription,
} from "./live-boost-control-contract.js";
import {
	hasLiveBoostControlFields,
	isLiveBoostControlReference,
} from "./live-boost-control-contract.js";

/** @public Read-only live-control source; it intentionally exposes no model or descriptor mutation. */
export interface LiveBoostControlRecordSource {
	resolve(enablementId: string): Promise<LiveBoostControlRecord | undefined>;
	subscribe(listener: (revision: LiveBoostControlRevision) => Promise<void>): LiveBoostControlSubscription;
}

/** @public Fixed authenticated issuer and clock used to gate live-control records. */
export interface LiveBoostControlAdapterOptions {
	readonly principalIssuerId: string;
	readonly now: () => number;
}

/** Creates a fail-closed adapter over an injected read-only live-control source. */
export function createLiveBoostControlAdapter(
	source: LiveBoostControlRecordSource,
	options: LiveBoostControlAdapterOptions,
): LiveBoostControlAdapter {
	return {
		resolve: async (reference) => {
			if (!isLiveBoostControlReference(reference)) {
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
			if (!isLiveBoostControlReference(reference)) {
				return undefined;
			}
			let active = true;
			let latestRevision = -1;
			let sourceSubscription: LiveBoostControlSubscription;
			try {
				sourceSubscription = source.subscribe(async (revision) => {
					if (!active || revision.enablementId !== reference.enablementId ||
						!isRevision(revision.revision) || revision.revision <= latestRevision) {
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

function isValidRecord(
	record: LiveBoostControlRecord | undefined,
	reference: LiveBoostControlReference,
	options: LiveBoostControlAdapterOptions,
): record is LiveBoostControlRecord {
	return hasLiveBoostControlFields(record) && record.enablementId === reference.enablementId &&
		record.principalIssuerId === options.principalIssuerId && Number.isSafeInteger(record.maximumYields) &&
		record.maximumYields >= 1 && record.maximumYields <= 3 && isRevision(record.revision) &&
		record.enabled === true && Number.isFinite(record.expiresAt) && record.expiresAt > options.now();
}

function isRevision(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}
