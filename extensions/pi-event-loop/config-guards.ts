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

const DECODED_ESCAPES: ReadonlyMap<string, string> = new Map([
	['"', '"'],
	["\\", "\\"],
	["/", "/"],
	["b", "\b"],
	["f", "\f"],
	["n", "\n"],
	["r", "\r"],
	["t", "\t"],
]);

/**
 * Detect the first duplicate key within a single JSON object literal by scanning the raw text.
 * JSON.parse's reviver cannot see duplicates because later keys overwrite earlier ones before
 * the post-parse walk, so the scan must run on the source text.
 */
export function findDuplicateJsonKey(text: string): string | undefined {
	interface ContainerFrame {
		readonly isObject: boolean;
		readonly keys: Set<string>;
		expectingKey: boolean;
	}
	const frames: ContainerFrame[] = [];
	let inString = false;
	let escapePending = false;
	let unicodePending = 0;
	let unicodeValue = 0;
	let buffer = "";
	let collectingKey = false;
	for (let index = 0; index < text.length; index++) {
		const char = text[index] ?? "";
		if (inString) {
			if (escapePending) {
				escapePending = false;
				if (char === "u") {
					unicodePending = 4;
					unicodeValue = 0;
				} else {
					buffer += DECODED_ESCAPES.get(char) ?? char;
				}
				continue;
			}
			if (unicodePending > 0) {
				const digit = Number.parseInt(char, 16);
				if (Number.isNaN(digit)) {
					// Malformed escape; JSON.parse rejects the document later.
					unicodePending = 0;
				} else {
					unicodeValue = unicodeValue * 16 + digit;
					unicodePending--;
					if (unicodePending === 0) {
						buffer += String.fromCharCode(unicodeValue);
					}
				}
				continue;
			}
			if (char === "\\") {
				escapePending = true;
				continue;
			}
			if (char === '"') {
				inString = false;
				if (collectingKey) {
					collectingKey = false;
					const top = frames.at(-1);
					if (top !== undefined && top.isObject) {
						if (top.keys.has(buffer)) {
							return buffer;
						}
						top.keys.add(buffer);
					}
				}
				continue;
			}
			buffer += char;
			continue;
		}
		const top = frames.at(-1);
		if (char === '"') {
			inString = true;
			buffer = "";
			collectingKey = false;
			if (top !== undefined && top.isObject && top.expectingKey) {
				collectingKey = true;
				top.expectingKey = false;
			}
			continue;
		}
		if (char === "{") {
			frames.push({
				isObject: true,
				keys: new Set<string>(),
				expectingKey: true,
			});
			continue;
		}
		if (char === "[") {
			frames.push({
				isObject: false,
				keys: new Set<string>(),
				expectingKey: false,
			});
			continue;
		}
		if (char === "}" || char === "]") {
			frames.pop();
			continue;
		}
		if (char === "," && top !== undefined && top.isObject) {
			top.expectingKey = true;
		}
	}
	return undefined;
}
