/** Shared validation guards for .pi/event-loop.json parsing (SPEC §6, §18). */

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

export function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((entry) => isNonEmptyString(entry))
	);
}

export function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export function checkUnknownKeys(
	record: Record<string, unknown>,
	allowed: readonly string[],
	path: string,
	errors: string[],
): boolean {
	let valid = true;
	for (const key of Object.keys(record)) {
		if (!allowed.includes(key)) {
			errors.push(`${path}: unknown field "${key}"`);
			valid = false;
		}
	}
	return valid;
}
