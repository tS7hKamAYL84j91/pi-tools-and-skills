/** Operator-provisioned HTTP identities; tool arguments never select a principal. */
import { timingSafeEqual } from "node:crypto";

export interface HttpPrincipal {
	principal: string;
	bearerToken: string;
}

export function parseHttpPrincipals(value: unknown): HttpPrincipal[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw new Error("Invalid httpPrincipals");
	const principals = new Set<string>();
	const tokens = new Set<string>();
	return value.map((entry: unknown) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid HTTP identity");
		const item = entry as Record<string, unknown>;
		if (Object.keys(item).some((key) => key !== "principal" && key !== "bearerToken") ||
			typeof item.principal !== "string" || !item.principal.trim() ||
			typeof item.bearerToken !== "string" || item.bearerToken.length < 16 ||
			principals.has(item.principal) || tokens.has(item.bearerToken)) throw new Error("Invalid or ambiguous HTTP identities");
		principals.add(item.principal);
		tokens.add(item.bearerToken);
		return { principal: item.principal, bearerToken: item.bearerToken };
	});
}

export function authenticatePrincipal(header: string | undefined, identities: readonly HttpPrincipal[]): string | undefined {
	if (!header?.startsWith("Bearer ")) return undefined;
	const supplied = Buffer.from(header.slice(7));
	let principal: string | undefined;
	for (const identity of identities) {
		const expected = Buffer.from(identity.bearerToken);
		if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) principal = identity.principal;
	}
	return principal;
}
