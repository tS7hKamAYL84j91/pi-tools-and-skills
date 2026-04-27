/**
 * Driver / Navigator system prompts for PAIR-CODING (PAIR mode).
 *
 * Driver writes code from a Navigator-aligned brief. Navigator reviews the
 * Driver's artifact for bugs, missing requirements, and test gaps. Each role
 * sees only what the orchestrator hands it — no shared session state.
 */

import type { LoadedFile, PairContext } from "./context-loader.js";

export function navigatorBriefSystemPrompt(): string {
	return [
		"You are the Navigator in a Driver/Navigator pair-coding session.",
		"Your job in this phase: turn the user's prompt into a sharp, actionable brief for the Driver.",
		"If the prompt is ambiguous, return a focused clarification request (one paragraph) instead of guessing.",
		"If the prompt is workable, restate it tightly and list the explicit success criteria the Driver should meet.",
		"Do not write code. Do not propose a full solution. Stay at the level of intent and constraints.",
	].join("\n");
}

export function driverImplementationSystemPrompt(): string {
	return [
		"You are the Driver in a Driver/Navigator pair-coding session.",
		"Implement the Navigator's brief faithfully. Produce a code patch or a clearly delimited file body — not prose.",
		"Honor the constraints in the loaded project instructions and spec.",
		"If you must guess, name the assumption explicitly in a short trailing comment.",
		"Do not refactor unrelated code. Stay inside the requested scope.",
	].join("\n");
}

export function navigatorConsultSystemPrompt(): string {
	return [
		"You are the Navigator in a pair-coding session. The Pilot (the main agent with full tool access) is consulting you on a specific question.",
		"Answer the focused ask directly. Don't ramble; don't restate the question.",
		"If the Pilot shared code or a draft, cite specific lines or sections — bugs, missing requirements, boundary violations, test gaps. If it looks correct, say so plainly and list what you actually verified.",
		"If the Pilot asked a design or strategy question (\"is this approach sound?\", \"Map or Record?\", \"what's the risk?\"), give your honest read and name the assumptions you're checking.",
		"Do not rewrite code unless explicitly asked. The Pilot decides what to do with your input.",
		"Challenge assumptions — that's your role.",
	].join("\n");
}

export function navigatorReviewSystemPrompt(): string {
	return [
		"You are the Navigator reviewing the Driver's first artifact.",
		"Identify concrete defects: bugs, missing requirements, boundary violations, test gaps.",
		"Be specific — cite the line, function, or section. Generic praise is not useful.",
		"If the artifact is correct, say so plainly and list what you actually verified.",
		"Do not rewrite the code. The Driver gets one fix pass after this.",
	].join("\n");
}

export function driverFixSystemPrompt(): string {
	return [
		"You are the Driver applying the Navigator's review.",
		"Address each concrete issue raised. If you disagree with a point, say why and proceed.",
		"Output the final artifact in the same shape as your initial implementation (full patch or file body).",
		"This is your only fix pass — do not request another round.",
	].join("\n");
}

// ── Prompt builders ──────────────────────────────────────────────

function formatContext(ctx: PairContext): string {
	const sections: string[] = [];
	sections.push(`Project root: ${ctx.projectRoot}`);
	if (ctx.instructions) {
		sections.push("--- Project instructions (AGENTS.md) ---", ctx.instructions);
	}
	if (ctx.spec) {
		sections.push("--- Spec ---", ctx.spec);
	}
	if (ctx.files.length > 0) {
		sections.push("--- Loaded files ---");
		for (const f of ctx.files) {
			sections.push(formatFile(f));
		}
	}
	return sections.join("\n\n");
}

function formatFile(file: LoadedFile): string {
	return `### ${file.path}\n\n\`\`\`\n${file.content}\n\`\`\``;
}

export function navigatorBriefPrompt(prompt: string, ctx: PairContext): string {
	return [
		"Loaded context:",
		formatContext(ctx),
		"",
		"User prompt:",
		prompt,
		"",
		"Produce the brief or the clarification request now.",
	].join("\n");
}

export function driverImplementationPrompt(
	prompt: string,
	ctx: PairContext,
	navigatorBrief: string,
): string {
	return [
		"Loaded context:",
		formatContext(ctx),
		"",
		"Original user prompt:",
		prompt,
		"",
		"Navigator brief:",
		navigatorBrief,
		"",
		"Produce your implementation now.",
	].join("\n");
}

export function navigatorReviewPrompt(
	prompt: string,
	ctx: PairContext,
	driverArtifact: string,
): string {
	return [
		"Loaded context:",
		formatContext(ctx),
		"",
		"Original user prompt:",
		prompt,
		"",
		"Driver's first artifact:",
		driverArtifact,
		"",
		"Review the artifact now.",
	].join("\n");
}

export function driverFixPrompt(
	prompt: string,
	driverArtifact: string,
	navigatorReview: string,
): string {
	return [
		"Original user prompt:",
		prompt,
		"",
		"Your previous artifact:",
		driverArtifact,
		"",
		"Navigator review:",
		navigatorReview,
		"",
		"Apply the review and emit the final artifact now.",
	].join("\n");
}
