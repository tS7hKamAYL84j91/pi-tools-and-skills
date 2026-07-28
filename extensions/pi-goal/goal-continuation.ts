/** Goal-run continuation marker formatting and parsing. */

const CONTINUATION_MARKER_PREFIX = "pi-goal-continuation:";
// Semgrep's TypeScript parser misreads a regex literal beginning with an HTML comment opener.
const CONTINUATION_MARKER_PATTERN = new RegExp(`<!--\\s*${CONTINUATION_MARKER_PREFIX}([^>]+)\\s*-->`);

export function continuationMarker(goalId: string, iteration: number): string {
	return `${goalId}:${iteration}`;
}

export function continuationMarkerComment(marker: string): string {
	return `<!-- ${CONTINUATION_MARKER_PREFIX}${marker} -->`;
}

export function extractContinuationMarker(prompt: string): string | undefined {
	return prompt.match(CONTINUATION_MARKER_PATTERN)?.[1]?.trim();
}
