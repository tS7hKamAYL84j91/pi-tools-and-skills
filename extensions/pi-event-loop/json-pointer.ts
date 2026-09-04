/** JSON Pointer (RFC 6901) key selection for projection rules (SPEC §6, §9). */



export function isValidJsonPointer(pointer: string): boolean {
	if (pointer.length === 0) {
		return true;
	}
	if (!pointer.startsWith("/")) {
		return false;
	}
	for (let index = 0; index < pointer.length; index++) {
		if (pointer[index] === "~") {
			const next = pointer[index + 1];
			if (next !== "0" && next !== "1") {
				return false;
			}
		}
	}
	return true;
}

interface PointerResolution {
	readonly found: boolean;
	readonly value: unknown;
}

function resolveJsonPointer(
	document: unknown,
	pointer: string,
): PointerResolution {
	if (pointer.length === 0) {
		return { found: true, value: document };
	}
	let current: unknown = document;
	for (const rawToken of pointer.split("/").slice(1)) {
		const token = rawToken.replaceAll("~1", "/").replaceAll("~0", "~");
		if (Array.isArray(current)) {
			if (!/^\d+$/.test(token) || Number(token) >= current.length) {
				return { found: false, value: undefined };
			}
			current = current[Number(token)];
			continue;
		}
		if (current === null || typeof current !== "object") {
			return { found: false, value: undefined };
		}
		const container = current as Record<string, unknown>;
		if (!Object.hasOwn(container, token)) {
			return { found: false, value: undefined };
		}
		current = container[token];
	}
	return { found: true, value: current };
}

/** Extract a stable string projection key from a payload, or undefined when no usable key exists. */
export function projectionKey(
	payload: Readonly<Record<string, unknown>>,
	keyFrom: string,
): string | undefined {
	if (!isValidJsonPointer(keyFrom)) {
		return undefined;
	}
	const resolution = resolveJsonPointer(payload, keyFrom);
	if (!resolution.found) {
		return undefined;
	}
	const value = resolution.value;
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return undefined;
}
