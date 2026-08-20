/** Stable bounded audit identity that cannot disclose host/session identifiers. */

import { createHash } from "node:crypto";

export function redactedBoostAuditId(
	kind: "enablement" | "subject" | "lease",
	value: string,
): string {
	const digest = createHash("sha256")
		.update(kind)
		.update("\0")
		.update(value)
		.digest("hex");
	return `${kind}-${digest.slice(0, 16)}`;
}
