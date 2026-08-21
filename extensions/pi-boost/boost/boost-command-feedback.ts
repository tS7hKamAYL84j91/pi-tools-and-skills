/** Bounded human-facing feedback for Boost parser errors. */

import type { BoostParseErrorCode } from "./boost-parse-types.js";
import type { BoostDenialReason, BoostLeaseStatus } from "./contracts.js";

export function formatBoostStatus(label: string, status: BoostLeaseStatus): string {
	const fields = [`state=${status.state}`];
	if (status.leaseId !== undefined) fields.push(`id=${opaqueId(status.leaseId)}`);
	if (status.remainingYields !== undefined && Number.isSafeInteger(status.remainingYields) && status.remainingYields >= 0) {
		fields.push(`remaining=${status.remainingYields}`);
	}
	if (status.expiresAt !== undefined && Number.isFinite(status.expiresAt)) fields.push(`expiresAt=${status.expiresAt}`);
	return `${label}: ${fields.join(" ")}`;
}

export function boostDenialLabel(reason: BoostDenialReason): string {
	return reason.replaceAll("-", " ");
}

export function boundedBoostReason(reason: string): string {
	return /^[a-z-]{1,32}$/.test(reason) ? reason.replaceAll("-", " ") : "unavailable";
}

function opaqueId(value: string): string {
	return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : "redacted";
}

export function boostParseFeedback(code: BoostParseErrorCode): string {
	switch (code) {
		case "invalid-yield-count":
			return "Boost option error: -n must be 1, 2, or 3";
		case "invalid-panel-size":
			return "Boost fusion option error: -n/--panel-size must be 1, 2, 3, or 4";
		case "invalid-profile":
			return "Boost fusion option error: --profile must be fast, balanced, or thorough";
		case "repeated-option":
			return "Boost option error: options may be specified only once";
		case "conflicting-isolation":
			return "Boost option error: --clean and --fresh are mutually exclusive";
		case "unknown-option":
			return "Boost option error: unknown option";
		case "trailing-subcommand":
			return "Boost syntax error: status/reset accept no trailing text; use -- for a prompt";
		case "input-too-large":
			return "Boost request rejected: input exceeds byte limit";
		case "not-boost-command":
		case "missing-prompt":
			return "Usage: /boost status | reset | settings | fusion [--profile fast|balanced|thorough] [-n 1..4] [--] <prompt> | [-n 1..3] [--clean|--fresh] [--] <prompt>";
	}
}
