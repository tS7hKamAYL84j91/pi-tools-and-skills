/**
 * Council prompt renderers for the 3-stage protocol.
 *
 * Prompt bodies live in `config.json`; this module only anonymizes dynamic
 * model output and fills configured templates.
 */

import type { ResolvedCouncilSettings } from "./settings.js";
import type { CouncilDeliberation, CouncilMember, ModelRun } from "./types.js";

type PromptConfig = ResolvedCouncilSettings["prompts"];

interface TemplateValues {
	[key: string]: string;
}

function renderTemplate(lines: string[], values: TemplateValues): string {
	let rendered = lines.join("\n");
	for (const [key, value] of Object.entries(values)) {
		rendered = rendered.replaceAll(`{{${key}}}`, value);
	}
	return rendered;
}

export function generationSystemPrompt(promptsConfig: PromptConfig): string {
	return promptsConfig.councilGenerationSystem.join("\n");
}

export function critiqueSystemPrompt(promptsConfig: PromptConfig): string {
	return promptsConfig.councilCritiqueSystem.join("\n");
}

export function chairmanSystemPrompt(promptsConfig: PromptConfig): string {
	return promptsConfig.councilChairmanSystem.join("\n");
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
	return renderTemplate(args.promptsConfig.councilCritiqueTemplate, {
		originalPrompt: args.originalPrompt,
		answers,
	});
}

export function synthesisPrompt(
	record: CouncilDeliberation,
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
	return renderTemplate(promptsConfig.councilSynthesisTemplate, {
		originalPrompt: record.prompt,
		rawAnswers,
		critiques,
	});
}
