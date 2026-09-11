/**
 * Boost prompt modes: frame construction, mode parsing, and bounded
 * current-problem context. Plain mode is the default (verbatim prompt injection).
 * Plan and challenge modes are opt-in via first word.
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
 * Plan mode: a concise TODO plan only, written to TODO.md. Planning never
 * authorizes execution; the user reviews the plan before anything runs.
 */
export const PLAN_FRAME =
	"Produce a concise, actionable TODO plan for the request below and write it to TODO.md: list the concrete steps, their dependencies, and the first step to take. This is planning only — write the plan to TODO.md, but do not start implementing, modify other files, or treat it as authorization to execute; the user will review the plan first.\n\n";

const BOOST_MODES = ["plain", "plan", "challenge"] as const;
export type BoostMode = (typeof BOOST_MODES)[number];

/** Wrap a prompt in the framing for the given boost mode (plain passes through verbatim). */
export function formatBoostMessage(mode: BoostMode, prompt: string): string {
	if (mode === "plan") return PLAN_FRAME + prompt;
	if (mode === "challenge") return CHALLENGE_FRAME + prompt;
	return prompt;
}

/**
 * First word selects an opt-in mode ('plan' or 'challenge');
 * otherwise defaults to plain mode (verbatim prompt injection).
 */
export function parseBoostMode(rest: string): { mode: BoostMode; prompt: string } {
	const trimmed = rest.trim();
	const first = trimmed.split(/\s+/)[0] ?? "";
	if (first === "plan" || first === "challenge") {
		return { mode: first, prompt: trimmed.slice(first.length).trim() };
	}
	return { mode: "plain", prompt: trimmed };
}

function userMessageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (
			typeof part === "object" &&
			part !== null &&
			"text" in part &&
			typeof part.text === "string"
		) {
			parts.push(part.text);
		}
	}
	return parts.join(" ").trim();
}

/** Maximum length for bounded recent-problem context. */
const MAX_RECENT_PROBLEM_CHARS = 1500;

/** Boost-injected prompts carry anti-rut (legacy + challenge) or plan framing. */
function isBoostFramed(text: string): boolean {
	return (
		text.startsWith(ANTI_RUT_FRAME) ||
		text.startsWith(PLAN_FRAME) ||
		text.startsWith("Produce a concise, actionable TODO plan for the request below")
	);
}

/**
 * Extract the most recent real user problem from branch entries.
 * Boost-injected prompts are skipped and text is bounded to 1500 characters.
 */
export function findRecentUserProblem(entries: readonly unknown[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as
			| { type?: string; message?: { role?: string; content?: unknown } }
			| undefined;
		if (entry?.type !== "message" || !entry.message || entry.message.role !== "user") continue;
		const text = userMessageText(entry.message.content).trim();
		if (!text || isBoostFramed(text)) continue;
		return text.slice(0, MAX_RECENT_PROBLEM_CHARS);
	}
	return undefined;
}

/**
 * Most recent real user problem from the current branch, bounded: boost-injected
 * framed prompts are skipped, the text is truncated, and history is never replayed.
 */
export async function recentUserProblem(ctx: ExtensionContext): Promise<string | undefined> {
	try {
		const branch = ctx.sessionManager?.getBranch?.() ?? [];
		return findRecentUserProblem(branch);
	} catch {
		/* malformed entries are skipped; omitted-prompt boosts need real context */
		return undefined;
	}
}
