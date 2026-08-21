/** Pure prompt rendering, markdown fence stripping, and judge-output validation for Cognitive Boost deliberation. */

import type {
	CognitiveJudgeOutput,
	CognitiveNodeRun,
} from "./cognitive-types.js";

export const INVALID_JUDGE_FALLBACK = JSON.stringify({
	answer:
		"Cognitive boost judge validation failed; review the degraded diagnostics before acting.",
	consensus: [],
	contradictions: [],
	partialCoverage: [],
	uniqueInsights: [],
	blindSpots: ["judge returned invalid JSON"],
	confidence: "low",
	missingEvidence: ["judge analysis unavailable"],
});

/** Truncate text cleanly at a semantic paragraph, sentence, or word boundary. */
export function truncateAtSemanticBoundary(
	text: string,
	maxChars: number,
): string {
	if (text.length <= maxChars) {
		return text;
	}
	if (maxChars <= 0) {
		return "";
	}
	const marker = "\n[truncated]";
	const contentBudget = Math.max(0, maxChars - marker.length);
	const candidate = text.slice(0, contentBudget);
	const minimumBoundary = Math.floor(contentBudget * 0.6);
	const boundary = Math.max(
		candidate.lastIndexOf("\n\n"),
		candidate.lastIndexOf("\n"),
		candidate.lastIndexOf(". "),
		candidate.lastIndexOf(" "),
	);
	const content =
		boundary >= minimumBoundary
			? candidate.slice(0, boundary + 1).trimEnd()
			: candidate;
	return `${content}${marker}`.slice(0, maxChars);
}

/** Render a bounded judge prompt containing panel responses and the strict JSON schema instruction. */
export function renderJudgePrompt(
	originalPrompt: string,
	panelRuns: readonly CognitiveNodeRun[],
	maxPromptChars: number,
	maxPanelChars: number,
): string {
	const instruction =
		"Return only JSON with every key: answer, consensus, contradictions, partialCoverage, uniqueInsights, blindSpots, confidence, missingEvidence. answer must be a concise, self-contained final answer to the original prompt.";
	const boundedOriginal = truncateAtSemanticBoundary(
		originalPrompt,
		Math.max(0, Math.floor(maxPromptChars / 3)),
	);
	const panelText = panelRuns
		.map(
			(run, index) =>
				`--- Panel ${index + 1}: ${run.model} ---\n${truncateAtSemanticBoundary(run.output, maxPanelChars)}`,
		)
		.join("\n\n");
	const body = [
		"Original prompt:",
		boundedOriginal,
		"",
		"Panel responses:",
		panelText,
	].join("\n");
	const bodyBudget = Math.max(0, maxPromptChars - instruction.length - 2);
	return `${truncateAtSemanticBoundary(body, bodyBudget)}\n\n${instruction}`;
}

/** Strip markdown code block fences and trailing prose around JSON blocks. */
export function stripMarkdownFences(text: string): string {
	const trimmed = text.trim();
	const fencePositions: number[] = [];
	let index = 0;
	while (true) {
		const next = trimmed.indexOf("```", index);
		if (next === -1) {
			break;
		}
		fencePositions.push(next);
		index = next + 3;
	}
	if (fencePositions.length >= 2) {
		const first = fencePositions[0];
		const last = fencePositions[fencePositions.length - 1];
		if (first !== undefined && last !== undefined) {
			let content = trimmed.slice(first + 3, last).trim();
			const firstNewline = content.indexOf("\n");
			if (firstNewline !== -1) {
				const firstLine = content.slice(0, firstNewline).trim();
				if (/^[a-zA-Z0-9]+$/.test(firstLine) && firstLine.length <= 20) {
					content = content.slice(firstNewline + 1).trim();
				}
			}
			try {
				JSON.parse(content);
				return content;
			} catch {
				// Fall through to the leading fence regex below.
			}
		}
	}
	const openMatch = trimmed.match(/^```[a-zA-Z]*\n?/);
	if (!openMatch) {
		return trimmed;
	}
	const afterOpen = trimmed.slice(openMatch[0].length);
	const closeIndex = afterOpen.lastIndexOf("\n```");
	if (closeIndex === -1) {
		return afterOpen.trim();
	}
	return afterOpen.slice(0, closeIndex).trim();
}

/** Validate whether text parses as a valid structured judge JSON payload. */
export function isValidJudgeJson(text: string): boolean {
	try {
		const parsed: unknown = JSON.parse(stripMarkdownFences(text));
		if (typeof parsed !== "object" || parsed === null) {
			return false;
		}
		const record = parsed as Record<string, unknown>;
		const arrayKeys = [
			"consensus",
			"contradictions",
			"partialCoverage",
			"uniqueInsights",
			"blindSpots",
			"missingEvidence",
		] as const;
		return (
			typeof record.answer === "string" &&
			record.answer.trim().length > 0 &&
			typeof record.confidence === "string" &&
			arrayKeys.every((key) => Array.isArray(record[key]))
		);
	} catch {
		// Non-JSON string is invalid.
		return false;
	}
}

/** Parse and normalize structured judge JSON output. */
export function parseJudgeJson(text: string): CognitiveJudgeOutput | undefined {
	if (!isValidJudgeJson(text)) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(stripMarkdownFences(text)) as Record<
			string,
			unknown
		>;
		return {
			answer: String(parsed.answer ?? "").trim(),
			consensus: Array.isArray(parsed.consensus)
				? parsed.consensus.map(String)
				: [],
			contradictions: Array.isArray(parsed.contradictions)
				? parsed.contradictions.map(String)
				: [],
			partialCoverage: Array.isArray(parsed.partialCoverage)
				? parsed.partialCoverage.map(String)
				: [],
			uniqueInsights: Array.isArray(parsed.uniqueInsights)
				? parsed.uniqueInsights.map(String)
				: [],
			blindSpots: Array.isArray(parsed.blindSpots)
				? parsed.blindSpots.map(String)
				: [],
			confidence: String(parsed.confidence ?? "medium"),
			missingEvidence: Array.isArray(parsed.missingEvidence)
				? parsed.missingEvidence.map(String)
				: [],
		};
	} catch {
		// Return undefined on parse error.
		return undefined;
	}
}
