/**
 * Matrix extension — MXID parsing utility.
 */

/**
 * Strip the leading `@` and the homeserver suffix from an MXID, leaving
 * just the localpart for use as the `from` label.
 *
 *   `@jim:matrix.org`              → `jim`
 *   `@jim.smith:matrix.example.net`  → `jim.smith`
 */
export function mxidLocalpart(mxid: string | undefined): string {
	if (!mxid) return "unknown";
	const noAt = mxid.startsWith("@") ? mxid.slice(1) : mxid;
	const colon = noAt.indexOf(":");
	const localpart = colon === -1 ? noAt : noAt.slice(0, colon);
	return localpart.length > 0 ? localpart : "unknown";
}
