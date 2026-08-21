/** Shared CoAS identifier and timestamp helpers used by lib modules. */

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function isoUtc(date = new Date()): string {
	return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function assertSafeId(label: string, value: string): void {
	if (!SAFE_ID_PATTERN.test(value) || value.includes("..")) {
		throw new Error(`Invalid ${label}: ${value}`);
	}
}
