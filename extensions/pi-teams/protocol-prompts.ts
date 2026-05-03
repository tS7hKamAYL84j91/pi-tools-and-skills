/** Runtime prompt packaging helpers for protocol phases. */

import type { LoadedFile, TeamContext } from "./context-loader.js";
import { renderTemplate } from "./prompt-renderer.js";
import type { TeamParticipant, ModelRun } from "./types.js";

/** Replace each participant's model id and live-agent name with its anonymous label. */
function anonymizeParticipantReferences(text: string, members: readonly TeamParticipant[]): string {
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

export function formatProtocolContext(ctx: TeamContext): string {
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
		for (const file of ctx.files) sections.push(formatFile(file));
	}
	return sections.join("\n\n");
}

function formatFile(file: LoadedFile): string {
	return `### ${file.path}\n\n\`\`\`\n${file.content}\n\`\`\``;
}
