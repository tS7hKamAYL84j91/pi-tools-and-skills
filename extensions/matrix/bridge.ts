/**
 * Matrix extension — MXID parsing utility.
 */

/**
 * Strip the leading `@` and the homeserver suffix from an MXID, leaving
 * just the localpart for use as the `from` label.
 *
 *   `@jim:matrix.org`              → `jim`
 *   `@jim.smith:coas.tail.ts.net`  → `jim.smith`
 */
export function mxidLocalpart(mxid: string): string {
	const noAt = mxid.startsWith("@") ? mxid.slice(1) : mxid;
	const colon = noAt.indexOf(":");
	return colon === -1 ? noAt : noAt.slice(0, colon);
}
