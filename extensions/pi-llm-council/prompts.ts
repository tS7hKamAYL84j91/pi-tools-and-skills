/**
 * Council prompts — system prompts and prompt-builders for the 3-stage protocol.
 */

import type { CouncilDeliberation, CouncilMember, ModelRun } from "./types.js";

export function generationSystemPrompt(): string {
	return [
		"You are a council member in a multi-agent deliberation.",
		"Answer independently, as if you are the only model consulted.",
		"Do not hedge toward what you think other models might say.",
		"Surface assumptions, risks, and decision criteria.",
		"If facts are uncertain, say so explicitly.",
	].join("\n");
}

export function critiqueSystemPrompt(): string {
	return [
		"You are reviewing anonymized peer answers in a council debate.",
		"Judge logic, evidence, missing assumptions, and practical robustness.",
		"Do not infer model identity. Do not reward agreement for its own sake.",
		"If all answers agree on a point, question why. Consensus is not evidence of correctness.",
		"Identify unique insights each answer brings, not just an overall ranking.",
		"Rank the answers by merit and explain key critiques concisely.",
	].join("\n");
}

export function chairmanSystemPrompt(): string {
	return [
		"You are The Chairman of a multi-model council.",
		"Synthesize the strongest answer from independent responses and critiques.",
		"Weight independent reasoning higher than agreement: a point reached separately by multiple members is stronger than one that spread through conformity.",
		"You must explicitly preserve disagreement rather than smoothing it away.",
		"Return exactly these sections:",
		"1. Consensus Points",
		"2. Points of Disagreement",
		"3. Final Recommendation",
		"4. Confidence and Open Questions",
	].join("\n");
}

/** Replace each member's model id (and agent name, if any) in `text` with its anonymous label. */
function anonymizeText(text: string, members: CouncilMember[]): string {
	let anonymized = text;
	for (const member of members) {
		const tokens = [member.model];
		if (member.agentName) tokens.push(member.agentName);
		for (const token of tokens) {
			const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			anonymized = anonymized.replace(new RegExp(escaped, "gi"), member.label);
		}
	}
	return anonymized;
}

/**
 * Build the critique prompt for a single reviewer.
 *
 * The reviewer's own generation output is excluded from the answer set so
 * they cannot rank themselves — even with anonymization, a reviewer can
 * recognize their own output patterns and bias toward them.
 */
export function critiquePrompt(args: {
	originalPrompt: string;
	generation: ModelRun[];
	members: CouncilMember[];
	viewer: CouncilMember;
}): string {
	const peers = args.generation.filter((run) => run.member.label !== args.viewer.label);
	const answers = peers
		.map(
			(run) => `## ${run.member.label}\n${anonymizeText(run.output, args.members)}`,
		)
		.join("\n\n");
	return [
		"Original prompt:",
		args.originalPrompt,
		"",
		"Anonymized peer answers (your own answer is excluded):",
		answers,
		"",
		"Critique each answer, identify errors or missing considerations, then rank these peer answers from strongest to weakest.",
	].join("\n");
}

export function synthesisPrompt(record: CouncilDeliberation): string {
	const rawAnswers = record.generation
		.map((run) => `## ${run.member.label} (${run.member.model})\n${run.output}`)
		.join("\n\n");
	const critiques = record.critiques
		.map(
			(run) =>
				`## Critique by ${run.member.label}\n${anonymizeText(run.output, record.members)}`,
		)
		.join("\n\n");
	return [
		"Original prompt:",
		record.prompt,
		"",
		"Raw council answers:",
		rawAnswers,
		"",
		"Anonymized peer critiques and rankings:",
		critiques,
		"",
		"Produce the final council synthesis now. Highlight concrete disagreements and explain which side is more robust.",
	].join("\n");
}
