/**
 * RFC 8785 JSON Canonicalization Scheme (JCS), scoped to the envelope's
 * data model (strings and non-negative integers; no floats). Object keys are
 * recursively sorted; serialization matches ECMAScript JSON.stringify for
 * strings (JCS string escaping) — sufficient for the envelope schema, which
 * contains no floating-point values.
 */
export function canonicalJcs(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value) || !Number.isInteger(value)) {
			throw new Error(`JCS: non-integer number not supported by this envelope schema: ${value}`);
		}
		return String(value);
	}
	if (typeof value === "boolean") return value ? "true" : "false";
	if (Array.isArray(value)) return `[${value.map(canonicalJcs).join(",")}]`;
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			// JCS sorts by UTF-16 code units of the key.
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${canonicalJcs(val)}`).join(",")}}`;
	}
	throw new Error(`JCS: unsupported value type: ${typeof value}`);
}