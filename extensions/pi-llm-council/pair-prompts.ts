/**
 * Driver / Navigator prompts for PAIR-CODING (PAIR mode).
 *
 * Prompt bodies live as Markdown files with front matter under `prompts/`;
 * this module only renders configured templates with runtime context.
 */

import type { LoadedFile, PairContext } from "./context-loader.js";
import type { ResolvedCouncilSettings } from "./settings.js";

type PromptConfig = ResolvedCouncilSettings["prompts"];

interface PairPrimerArgs {
	pairName: string;
	navigator: string;
	task?: string;
	promptsConfig: PromptConfig;
}

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

export function navigatorBriefSystemPrompt(
	promptsConfig: PromptConfig,
): string {
	return promptsConfig.pairNavigatorBriefSystem.join("\n");
}

export function driverImplementationSystemPrompt(
	promptsConfig: PromptConfig,
): string {
	return promptsConfig.pairDriverImplementationSystem.join("\n");
}

export function navigatorConsultSystemPrompt(
	promptsConfig: PromptConfig,
): string {
	return promptsConfig.pairNavigatorConsultSystem.join("\n");
}

export function navigatorReviewSystemPrompt(
	promptsConfig: PromptConfig,
): string {
	return promptsConfig.pairNavigatorReviewSystem.join("\n");
}

export function driverFixSystemPrompt(promptsConfig: PromptConfig): string {
	return promptsConfig.pairDriverFixSystem.join("\n");
}

export function pairPrimerPrompt(args: PairPrimerArgs): string {
	return renderTemplate(args.promptsConfig.pairPrimer, {
		pairName: args.pairName,
		navigator: args.navigator,
		taskLine: args.task ? `\n\nTask: ${args.task}` : "",
	});
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

export function navigatorBriefPrompt(
	prompt: string,
	ctx: PairContext,
	promptsConfig: PromptConfig,
): string {
	return renderTemplate(promptsConfig.pairNavigatorBriefTemplate, {
		context: formatContext(ctx),
		prompt,
	});
}

export function driverImplementationPrompt(
	prompt: string,
	ctx: PairContext,
	navigatorBrief: string,
	promptsConfig: PromptConfig,
): string {
	return renderTemplate(promptsConfig.pairDriverImplementationTemplate, {
		context: formatContext(ctx),
		prompt,
		navigatorBrief,
	});
}

export function navigatorReviewPrompt(
	prompt: string,
	ctx: PairContext,
	driverArtifact: string,
	promptsConfig: PromptConfig,
): string {
	return renderTemplate(promptsConfig.pairNavigatorReviewTemplate, {
		context: formatContext(ctx),
		prompt,
		driverArtifact,
	});
}

export function driverFixPrompt(
	prompt: string,
	driverArtifact: string,
	navigatorReview: string,
	promptsConfig: PromptConfig,
): string {
	return renderTemplate(promptsConfig.pairDriverFixTemplate, {
		prompt,
		driverArtifact,
		navigatorReview,
	});
}
