/** Pure prompt rendering and judge-output validation for Fusion analysis. */

import { participantsFromRuns, type NodeRun } from "./team-node-runner.js";

export const INVALID_JUDGE_FALLBACK = JSON.stringify({
	answer: "Fusion judge validation failed; review the degraded diagnostics before acting.",
	consensus: [],
	contradictions: [],
	partialCoverage: [],
	uniqueInsights: [],
	blindSpots: ["judge returned invalid JSON"],
	confidence: "low",
	missingEvidence: ["judge analysis unavailable"],
});

function truncateAtSemanticBoundary(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	if (maxChars <= 0) return "";
	const marker = "\n[truncated]";
	const contentBudget = Math.max(0, maxChars - marker.length);
	const candidate = text.slice(0, contentBudget);
	const minimumBoundary = Math.floor(contentBudget * 0.6);
	const boundary = Math.max(candidate.lastIndexOf("\n\n"), candidate.lastIndexOf("\n"), candidate.lastIndexOf(". "), candidate.lastIndexOf(" "));
	const content = boundary >= minimumBoundary ? candidate.slice(0, boundary + 1).trimEnd() : candidate;
	return `${content}${marker}`.slice(0, maxChars);
}

export function renderJudgePrompt(originalPrompt: string, panelRuns: readonly NodeRun[], maxPromptChars: number, maxPanelChars: number): string {
	const instruction = "Return only JSON with every key: answer, consensus, contradictions, partialCoverage, uniqueInsights, blindSpots, confidence, missingEvidence. answer must be a concise, self-contained final answer to the original prompt.";
	const boundedOriginal = truncateAtSemanticBoundary(originalPrompt, Math.max(0, Math.floor(maxPromptChars / 3)));
	const panelText = participantsFromRuns(panelRuns)
		.map((run, index) => `--- Panel ${index + 1}: ${run.member.model} ---\n${truncateAtSemanticBoundary(run.output, maxPanelChars)}`)
		.join("\n\n");
	const body = ["Original prompt:", boundedOriginal, "", "Panel responses:", panelText].join("\n");
	const bodyBudget = Math.max(0, maxPromptChars - instruction.length - 2);
	return `${truncateAtSemanticBoundary(body, bodyBudget)}\n\n${instruction}`;
}

export function stripMarkdownFences(text: string): string {
	const trimmed = text.trim();
	const fencePositions: number[] = [];
	let index = 0;
	while (true) {
		const next = trimmed.indexOf("```", index);
		if (next === -1) break;
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
				// Fall through to the original leading-fence behavior.
			}
		}
	}
	const openMatch = trimmed.match(/^```[a-zA-Z]*\n?/);
	if (!openMatch) return trimmed;
	const afterOpen = trimmed.slice(openMatch[0].length);
	const closeIndex = afterOpen.lastIndexOf("\n```");
	if (closeIndex === -1) return afterOpen.trim();
	return afterOpen.slice(0, closeIndex).trim();
}

export function isValidJudgeJson(text: string): boolean {
	try {
		const parsed: unknown = JSON.parse(stripMarkdownFences(text));
		if (typeof parsed !== "object" || parsed === null) return false;
		const record = parsed as Record<string, unknown>;
		const arrayKeys = ["consensus", "contradictions", "partialCoverage", "uniqueInsights", "blindSpots", "missingEvidence"];
		return typeof record.answer === "string" && record.answer.trim().length > 0 && typeof record.confidence === "string" && arrayKeys.every((key) => Array.isArray(record[key]));
	} catch {
		return false;
	}
}
