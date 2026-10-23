/**
 * Logical mention parsing for a shared Matrix room.
 *
 * All leads share one Matrix user id, so Matrix pills/`m.mentions` cannot
 * distinguish them — mentioning the bot would notify every lead client. The
 * mention therefore has to be logical: a `@token` in the message body that each
 * client matches against its own launcher-declared names.
 *
 * Unmentioned messages are dropped *before* they reach the transport buffer, so
 * they cannot notify, queue or wake an agent. Silence is the default.
 */

/** Trailing sentence punctuation that must not become part of a token. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/**
 * Extract lower-cased logical mention tokens from a message body.
 *
 * A token is `@` followed by a name at a word boundary (`start` or a character
 * that is not a word character or `@`). `@name` and `@Name` are equivalent.
 * The name charset matches agent names (letters, digits, dot, underscore,
 * hyphen); a token is not allowed to start with `-`.
 */
export function extractMentions(body: string): string[] {
	if (!body) return [];
	const found: string[] = [];
	const pattern = /(^|[^\w@/])@([a-zA-Z0-9][a-zA-Z0-9._-]*)/g;
	for (const match of body.matchAll(pattern)) {
		const token = (match[2] ?? "").replace(TRAILING_PUNCTUATION, "").toLowerCase();
		if (token) found.push(token);
	}
	return found;
}

/**
 * Whether `body` mentions this agent.
 *
 * Matching is exact on the declared names (so `@gemma-4` does not match the
 * name `gemma`), or the reserved `@all` token when `all` is enabled.
 */
export function mentionsAgent(
	body: string,
	names: readonly string[],
	options: { all?: boolean } = {},
): boolean {
	const declared = new Set(
		names.map((name) => name.trim().toLowerCase()).filter((name) => name.length > 0),
	);
	if (options.all !== false) declared.add("all");
	return extractMentions(body).some((token) => declared.has(token));
}
