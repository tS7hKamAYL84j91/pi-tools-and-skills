/**
 * Council prompt renderers for the 3-stage protocol.
 *
 * Prompt bodies live as Markdown files with front matter under `prompts/`;
 * this module only anonymizes dynamic model output and fills configured templates.
 */

import { renderTemplate } from "./prompt-renderer.js";
import { promptAssetLines, promptAssetText } from "./prompt-resolver.js";
import type { ResolvedTeamSettings } from "./settings.js";
import type { TeamRunRecord, TeamParticipant, ModelRun } from "./types.js";

type PromptConfig = ResolvedTeamSettings["prompts"];

/** @public */
export function generationSystemPrompt(promptsConfig: PromptConfig): string {
	return promptAssetText(promptsConfig, "councilGenerationSystem");
}

/** @public */
export function critiqueSystemPrompt(promptsConfig: PromptConfig): string {
	return promptAssetText(promptsConfig, "councilCritiqueSystem");
}

/** @public */
export function chairmanSystemPrompt(promptsConfig: PromptConfig): string {
	return promptAssetText(promptsConfig, "councilChairmanSystem");
}

/** Replace each member's model id (and agent name, if any) in `text` with its anonymous label. */
function anonymizeText(text: string, members: TeamParticipant[]): string {
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
	members: TeamParticipant[];
	viewer: TeamParticipant;
	promptsConfig: PromptConfig;
}): string {
	const peers = args.generation.filter(
		(run) => run.member.label !== args.viewer.label,
	);
	const answers = peers
		.map(
			(run) =>
				`## ${run.member.label}\n${anonymizeText(run.output, args.members)}`,
		)
		.join("\n\n");
	return renderTemplate([...promptAssetLines(args.promptsConfig, "councilCritiqueTemplate")], {
		originalPrompt: args.originalPrompt,
		answers,
	});
}

/** @public */
export function synthesisPrompt(
	record: TeamRunRecord,
	promptsConfig: PromptConfig,
): string {
	const rawAnswers = record.generation
		.map((run) => `## ${run.member.label} (${run.member.model})\n${run.output}`)
		.join("\n\n");
	const critiques = record.critiques
		.map(
			(run) =>
				`## Critique by ${run.member.label}\n${anonymizeText(run.output, record.members)}`,
		)
		.join("\n\n");
	return renderTemplate([...promptAssetLines(promptsConfig, "councilSynthesisTemplate")], {
		originalPrompt: record.prompt,
		rawAnswers,
		critiques,
	});
}
