/** Strict limits validation for .pi/event-loop.json (SPEC §6, §18). */

import {
	checkUnknownKeys,
	isPositiveInteger,
	isRecord,
} from "./config-guards.js";
import type { LimitsConfig } from "./types.js";

export const DEFAULT_LIMITS: LimitsConfig = {
	maxPendingCommands: 20,
	maxOpenItemsPerView: 100,
	maxPayloadBytes: 16384,
	maxChainDepth: 12,
	maxConsecutiveTurns: 8,
	maxRecentEvents: 1000,
};

const LIMIT_CEILINGS: LimitsConfig = {
	maxPendingCommands: 100,
	maxOpenItemsPerView: 1000,
	maxPayloadBytes: 65536,
	maxChainDepth: 64,
	maxConsecutiveTurns: 64,
	maxRecentEvents: 10000,
};

const LIMIT_KEYS = [
	"maxPendingCommands",
	"maxOpenItemsPerView",
	"maxPayloadBytes",
	"maxChainDepth",
	"maxConsecutiveTurns",
	"maxRecentEvents",
] as const;

export function validateLimits(
	raw: unknown,
	errors: string[],
): LimitsConfig | undefined {
	if (raw === undefined) {
		return { ...DEFAULT_LIMITS };
	}
	if (!isRecord(raw)) {
		errors.push("configuration.limits: must be an object");
		return undefined;
	}
	let valid = checkUnknownKeys(raw, LIMIT_KEYS, "configuration.limits", errors);
	const overrides: Record<string, number> = {};
	for (const key of LIMIT_KEYS) {
		const value = raw[key];
		if (value === undefined) {
			continue;
		}
		if (!isPositiveInteger(value)) {
			errors.push(`configuration.limits.${key}: must be a positive integer`);
			valid = false;
			continue;
		}
		const ceiling: number = LIMIT_CEILINGS[key];
		if (value > ceiling) {
			errors.push(
				`configuration.limits.${key}: ${value} exceeds the ceiling of ${ceiling}`,
			);
			valid = false;
			continue;
		}
		overrides[key] = value;
	}
	if (!valid) {
		return undefined;
	}
	return {
		maxPendingCommands:
			overrides["maxPendingCommands"] ?? DEFAULT_LIMITS.maxPendingCommands,
		maxOpenItemsPerView:
			overrides["maxOpenItemsPerView"] ?? DEFAULT_LIMITS.maxOpenItemsPerView,
		maxPayloadBytes:
			overrides["maxPayloadBytes"] ?? DEFAULT_LIMITS.maxPayloadBytes,
		maxChainDepth: overrides["maxChainDepth"] ?? DEFAULT_LIMITS.maxChainDepth,
		maxConsecutiveTurns:
			overrides["maxConsecutiveTurns"] ?? DEFAULT_LIMITS.maxConsecutiveTurns,
		maxRecentEvents:
			overrides["maxRecentEvents"] ?? DEFAULT_LIMITS.maxRecentEvents,
	};
}
