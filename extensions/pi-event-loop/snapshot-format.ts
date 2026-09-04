/** Document-level snapshot narrowing over session entries (SPEC §15). */

import { isNonEmptyString, isRecord, isStringArray } from "./config-guards.js";
import type { SessionEntryLike } from "./event-log.js";
import {
	asCommandRecord,
	asCommandRecords,
	asTimerState,
	asTodoItems,
} from "./snapshot-records.js";
import { type EventLoopSnapshot, SNAPSHOT_CUSTOM_TYPE } from "./types.js";

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/** Header fields every valid snapshot carries; malformed headers reject the entry. */
interface SnapshotHeader {
	profileName: string;
	configFingerprint: string;
	projectedEventCount: number;
	paused: boolean;
	consecutiveAutomatedTurns: number;
}

function asSnapshotHeader(
	data: Record<string, unknown>,
): SnapshotHeader | undefined {
	if (data.schemaVersion !== 1) {
		return undefined;
	}
	const profileName = data.profileName;
	const configFingerprint = data.configFingerprint;
	if (!isNonEmptyString(profileName) || !isNonEmptyString(configFingerprint)) {
		return undefined;
	}
	if (
		!isNonNegativeInteger(data.projectedEventCount) ||
		typeof data.paused !== "boolean" ||
		!isNonNegativeInteger(data.consecutiveAutomatedTurns)
	) {
		return undefined;
	}
	return {
		profileName,
		configFingerprint,
		projectedEventCount: data.projectedEventCount,
		paused: data.paused,
		consecutiveAutomatedTurns: data.consecutiveAutomatedTurns,
	};
}

/** Narrow stored entry data to a well-formed snapshot; malformed entries are ignored, not repaired. */
export function asSnapshot(data: unknown): EventLoopSnapshot | undefined {
	if (!isRecord(data)) {
		return undefined;
	}
	const header = asSnapshotHeader(data);
	if (header === undefined) {
		return undefined;
	}
	const items = asTodoItems(data.items);
	if (items === undefined) {
		return undefined;
	}
	const pendingCommands = asCommandRecords(data.pendingCommands);
	if (pendingCommands === undefined) {
		return undefined;
	}
	const activeCommandRaw = data.activeCommand;
	const activeCommand =
		activeCommandRaw === undefined
			? undefined
			: asCommandRecord(activeCommandRaw);
	if (activeCommandRaw !== undefined && activeCommand === undefined) {
		return undefined;
	}
	if (!isStringArray(data.recentEventIds)) {
		return undefined;
	}
	const timerState = asTimerState(data.timerState);
	if (timerState === undefined) {
		return undefined;
	}
	return {
		schemaVersion: 1,
		profileName: header.profileName,
		configFingerprint: header.configFingerprint,
		projectedEventCount: header.projectedEventCount,
		lastAppliedEventId: optionalString(data.lastAppliedEventId),
		items,
		pendingCommands,
		activeCommand,
		recentEventIds: data.recentEventIds,
		timerState,
		paused: header.paused,
		pauseReason: optionalString(data.pauseReason),
		consecutiveAutomatedTurns: header.consecutiveAutomatedTurns,
	};
}

/**
 * Latest valid snapshot entry in branch order; corrupt entries (including a corrupt
 * tail) are ignored rather than fatal (SPEC §15).
 */
export function readLatestSnapshot(
	entries: readonly SessionEntryLike[],
): EventLoopSnapshot | undefined {
	let latest: EventLoopSnapshot | undefined;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== SNAPSHOT_CUSTOM_TYPE) {
			continue;
		}
		const snapshot = asSnapshot(entry.data);
		if (snapshot !== undefined) {
			latest = snapshot;
		}
	}
	return latest;
}
