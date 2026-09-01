/** Runtime prompt packaging helpers for protocol phases. */


import { renderTemplate } from "./prompt-renderer.js";
import type { TeamParticipant, ModelRun } from "./types.js";

function replaceCaseInsensitive(text: string, token: string, replacement: string): string {
	if (token.length === 0) return text;
	const normalizedText = text.toLowerCase();
	const normalizedToken = token.toLowerCase();
	let result = "";
	let start = 0;
	let match = normalizedText.indexOf(normalizedToken, start);
	while (match >= 0) {
		result += text.slice(start, match) + replacement;
		start = match + token.length;
		match = normalizedText.indexOf(normalizedToken, start);
	}
	return result + text.slice(start);
}

/** Replace each participant's model id and live-agent name with its anonymous label. */
function anonymizeParticipantReferences(text: string, members: readonly TeamParticipant[]): string {
	let anonymized = text;
	for (const member of members) {
		const tokens = [member.model];
		if (member.agentName) tokens.push(member.agentName);
		for (const token of tokens) anonymized = replaceCaseInsensitive(anonymized, token, member.label);
	}
	return anonymized;
}

export function renderPeerCritiquePrompt(args: {
	originalPrompt: string;
	generation: readonly ModelRun[];
	members: readonly TeamParticipant[];
	viewer: TeamParticipant;
	template: readonly string[];
}): string {
	const peers = args.generation.filter((run) => run.member.label !== args.viewer.label);
	const answers = peers
		.map((run) => `## ${run.member.label}\n${anonymizeParticipantReferences(run.output, args.members)}`)
		.join("\n\n");
	return renderTemplate([...args.template], {
		originalPrompt: args.originalPrompt,
		answers,
	});
}

export function renderJoinedSynthesisPrompt(args: {
	originalPrompt: string;
	generation: readonly ModelRun[];
	critiques: readonly ModelRun[];
	members: readonly TeamParticipant[];
	template: readonly string[];
}): string {
	const rawAnswers = args.generation
		.map((run) => `## ${run.member.label} (${run.member.model})\n${run.output}`)
		.join("\n\n");
	const critiques = args.critiques
		.map((run) => `## Critique by ${run.member.label}\n${anonymizeParticipantReferences(run.output, args.members)}`)
		.join("\n\n");
	return renderTemplate([...args.template], {
		originalPrompt: args.originalPrompt,
		rawAnswers,
		critiques,
	});
}


