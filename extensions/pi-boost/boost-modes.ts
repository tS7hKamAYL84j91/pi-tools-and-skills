/**
 * Boost prompt modes: frame construction, mode parsing, and bounded
 * current-problem context. Planning mode never authorizes execution; the
 * frames carry that contract. Challenge mode is the default.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Anti-rut framing for challenge-mode boosts (ADR-052). */
const ANTI_RUT_FRAME =
	"Challenge prior assumptions and inspect the underlying problem rather than repeating recent failed approaches.\n\n";

/** Challenge mode (default): reframe, then offer alternatives and a next move. */
export const CHALLENGE_FRAME =
	ANTI_RUT_FRAME +
	"Then offer two or three alternative approaches and one concrete useful next move.\n\n";

/**
 * Plan mode: a concise TODO plan only. Planning never authorizes execution;
 * the user reviews the plan before anything runs.
 */
export const PLAN_FRAME =
	"Produce a concise, actionable TODO plan for the request below: list the concrete steps, their dependencies, and the first step to take. This is planning only — do not start implementing, modify files, or treat it as authorization to execute; the user will review the plan first.\n\n";

const BOOST_MODES = ["plan", "challenge"] as const;
type BoostMode = (typeof BOOST_MODES)[number];

/** First word selects the mode (challenge is the default); the rest is the prompt. */
export function parseBoostMode(rest: string): { mode: BoostMode; prompt: string } {
	const first = rest.split(/\s+/)[0] ?? "";
	if (first === "plan" || first === "challenge") {
		return { mode: first, prompt: rest.slice(first.length).trim() };
	}
	return { mode: "challenge", prompt: rest };
}

function userMessageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) =>
			typeof part === "object" && part !== null && "text" in part && typeof (part as { text: unknown }).text === "string"
				? (part as { text: string }).text
				: "",
		)
		.join(" ")
		.trim();
}

/**
 * Most recent real user problem from the current branch, bounded: boost-injected
 * framed prompts are skipped, the text is truncated, and history is never replayed.
 */
export async function recentUserProblem(ctx: ExtensionContext): Promise<string | undefined> {
	try {
		const branch = ctx.sessionManager?.getBranch?.() ?? [];
		for (let index = branch.length - 1; index >= 0; index--) {
			const entry = branch[index] as
				| { type?: string; message?: { role?: string; content?: unknown } }
				| undefined;
			if (entry?.type !== "message" || !entry.message || entry.message.role !== "user") continue;
			const text = userMessageText(entry.message.content).trim();
			if (!text) continue;
			if (text.startsWith(ANTI_RUT_FRAME) || text.startsWith(PLAN_FRAME)) continue;
			return text.slice(0, 1500);
		}
	} catch {
		/* malformed entries are skipped; omitted-prompt boosts need real context */
	}
	return undefined;
}