/**
 * Driver / Navigator prompts for PAIR-CODING (PAIR mode).
 *
 * Prompt bodies live as Markdown files with front matter under `prompts/`;
 * this module only renders configured templates with runtime context.
 */

import type { LoadedFile, PairContext } from "./context-loader.js";
import { renderTemplate } from "./prompt-renderer.js";
import { promptAssetLines, promptAssetText } from "./prompt-resolver.js";
import type { ResolvedTeamSettings } from "./settings.js";

type PromptConfig = ResolvedTeamSettings["prompts"];

interface PairPrimerArgs {
	pairName: string;
	navigator: string;
	task?: string;
	promptsConfig: PromptConfig;
}

/** @public */
export function navigatorBriefSystemPrompt(
	promptsConfig: PromptConfig,
): string {
	return promptAssetText(promptsConfig, "pairNavigatorBriefSystem");
}

/** @public */
export function driverImplementationSystemPrompt(
	promptsConfig: PromptConfig,
): string {
	return promptAssetText(promptsConfig, "pairDriverImplementationSystem");
}

/** @public */
export function navigatorConsultSystemPrompt(
	promptsConfig: PromptConfig,
): string {
	return promptAssetText(promptsConfig, "pairNavigatorConsultSystem");
}

/** @public */
export function navigatorReviewSystemPrompt(
	promptsConfig: PromptConfig,
): string {
	return promptAssetText(promptsConfig, "pairNavigatorReviewSystem");
}

/** @public */
export function driverFixSystemPrompt(promptsConfig: PromptConfig): string {
	return promptAssetText(promptsConfig, "pairDriverFixSystem");
}

export function pairPrimerPrompt(args: PairPrimerArgs): string {
	return renderTemplate([...promptAssetLines(args.promptsConfig, "pairPrimer")], {
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

/** @public */
export function navigatorBriefPrompt(
	prompt: string,
	ctx: PairContext,
	promptsConfig: PromptConfig,
): string {
	return renderTemplate([...promptAssetLines(promptsConfig, "pairNavigatorBriefTemplate")], {
		context: formatContext(ctx),
		prompt,
	});
}

/** @public */
export function driverImplementationPrompt(
	prompt: string,
	ctx: PairContext,
	navigatorBrief: string,
	promptsConfig: PromptConfig,
): string {
	return renderTemplate([...promptAssetLines(promptsConfig, "pairDriverImplementationTemplate")], {
		context: formatContext(ctx),
		prompt,
		navigatorBrief,
	});
}

/** @public */
export function navigatorReviewPrompt(
	prompt: string,
	ctx: PairContext,
	driverArtifact: string,
	promptsConfig: PromptConfig,
): string {
	return renderTemplate([...promptAssetLines(promptsConfig, "pairNavigatorReviewTemplate")], {
		context: formatContext(ctx),
		prompt,
		driverArtifact,
	});
}

/** @public */
export function driverFixPrompt(
	prompt: string,
	driverArtifact: string,
	navigatorReview: string,
	promptsConfig: PromptConfig,
): string {
	return renderTemplate([...promptAssetLines(promptsConfig, "pairDriverFixTemplate")], {
		prompt,
		driverArtifact,
		navigatorReview,
	});
}
