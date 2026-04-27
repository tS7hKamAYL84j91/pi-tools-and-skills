/**
 * Interactive `/pair` command — single Driver/Navigator coding session.
 *
 * No persistent council state, no settings. The wizard picks two model ids,
 * collects the prompt, then runs the same `runPairCoding` orchestration the
 * `ask_council mode:PAIR` tool path uses. Files and specPath aren't picked
 * in the wizard for v1 — context-loader auto-discovers AGENTS.md + spec.md;
 * use the tool path with `files[]` if you need explicit files.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { snapshotAvailableModels } from "./members.js";
import { type PairResult, runPairCoding } from "./pair-coding.js";
import { pickModel } from "./picker.js";

function formatSummary(result: PairResult): string[] {
	const lines: string[] = [];
	lines.push(`Pair-coding ${result.ok ? "complete" : "ended with errors"}`);
	const phaseSummary = result.phases
		.filter((p) => p.name !== "complete")
		.map((p) => `  ${p.name}: ${p.ok ? "ok" : "fail"} (${Math.round(p.durationMs / 1000)}s)`);
	lines.push(...phaseSummary);
	if (result.context.warnings.length > 0) {
		lines.push("Context warnings:");
		for (const w of result.context.warnings) lines.push(`  - ${w}`);
	}
	if (result.errors.length > 0) {
		lines.push("Errors:");
		for (const e of result.errors) lines.push(`  - ${e}`);
	}
	lines.push("");
	lines.push(result.summary);
	return lines;
}

export function registerPairCommand(
	pi: ExtensionAPI,
	refreshStatus: (ctx: ExtensionContext) => void,
): void {
	pi.registerCommand("pair", {
		description: "Run a single Driver/Navigator pair-coding session",
		handler: async (args, ctx) => {
			const snapshot = snapshotAvailableModels(ctx);
			if (snapshot.length < 2) {
				ctx.ui.notify(
					`Need at least 2 distinct models for pair-coding; have ${snapshot.length}.`,
					"error",
				);
				return;
			}

			const driver = await pickModel(ctx, "Select Driver (coding model)", snapshot);
			if (!driver) return;

			const remaining = snapshot.filter((m) => m !== driver);
			const navigator = await pickModel(ctx, "Select Navigator (review model)", remaining, {
				selected: [driver],
			});
			if (!navigator) return;

			const promptInput = args.trim() || (await ctx.ui.editor("Coding task", ""));
			const prompt = promptInput?.trim();
			if (!prompt) return;

			ctx.ui.notify(`Pair: driver=${driver} navigator=${navigator}`, "info");
			try {
				const result = await runPairCoding({
					ctx,
					prompt,
					driver,
					navigator,
					onProgress: (label) => {
						ctx.ui.setStatus("council", `pair: ${label}`);
					},
				});
				ctx.ui.setWidget("council", formatSummary(result));
				ctx.ui.notify(
					result.ok ? "Pair complete." : "Pair ended with errors — see widget.",
					result.ok ? "info" : "warning",
				);
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			} finally {
				refreshStatus(ctx);
			}
		},
	});
}
