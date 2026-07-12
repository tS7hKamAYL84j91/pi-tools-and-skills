/** Pure user-facing team result extraction helpers. */

/** Return Fusion's final answer when available; preserve raw diagnostic bodies otherwise. */
export function directTeamResultBody(teamId: string, body: string): string {
	if (teamId !== "fusion-analysis") return body;
	try {
		const parsed: unknown = JSON.parse(body);
		if (typeof parsed !== "object" || parsed === null) return body;
		const answer = (parsed as Record<string, unknown>).answer;
		return typeof answer === "string" && answer.trim().length > 0 ? answer.trim() : body;
	} catch {
		return body;
	}
}
