/**
 * Slash-command lifecycle for pair-coding sessions.
 *
 *   /pair-form     — interactively name + pick driver + navigator + purpose
 *   /pair          — invoke a named pair (or ad-hoc if none formed) on a prompt
 *   /pair-list     — show session pairs
 *   /pair-dissolve — confirm + remove a named pair
 *
 * Pairs are session-local (no settings.json persistence) and don't share the
 * council slot machinery — a pair is just a driver/navigator tuple, not a
 * heterogeneous member set.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { snapshotAvailableModels } from "./members.js";
import { type PairResult, runPairCoding } from "./pair-coding.js";
import { pickModel } from "./picker.js";

export interface PairDefinition {
	name: string;
	driver: string;
	navigator: string;
	purpose?: string;
	createdAt: number;
}

function formatSummary(result: PairResult): string[] {
	const lines: string[] = [];
	lines.push(`Pair-coding ${result.ok ? "complete" : "ended with errors"}`);
	for (const p of result.phases) {
		if (p.name === "complete") continue;
		lines.push(`  ${p.name}: ${p.ok ? "ok" : "fail"} (${Math.round(p.durationMs / 1000)}s)`);
	}
	for (const w of result.context.warnings) lines.push(`warning: ${w}`);
	for (const e of result.errors) lines.push(`error: ${e}`);
	lines.push("");
	lines.push(result.summary);
	return lines;
}

function pairLine(p: PairDefinition): string {
	const purpose = p.purpose ? ` | ${p.purpose}` : "";
	return `- ${p.name}: driver=${p.driver}  navigator=${p.navigator}${purpose}`;
}

interface PairContextArgs {
	prompt: string;
	driver: string;
	navigator: string;
	ctx: ExtensionContext;
	refreshStatus: (ctx: ExtensionContext) => void;
}

async function executePair(args: PairContextArgs): Promise<void> {
	args.ctx.ui.notify(
		`Pair: driver=${args.driver} navigator=${args.navigator}`,
		"info",
	);
	try {
		const result = await runPairCoding({
			ctx: args.ctx,
			prompt: args.prompt,
			driver: args.driver,
			navigator: args.navigator,
			onProgress: (label) => {
				args.ctx.ui.setStatus("council", `pair: ${label}`);
			},
		});
		args.ctx.ui.setWidget("council", formatSummary(result));
		args.ctx.ui.notify(
			result.ok ? "Pair complete." : "Pair ended with errors — see widget.",
			result.ok ? "info" : "warning",
		);
	} catch (error) {
		args.ctx.ui.notify(
			error instanceof Error ? error.message : String(error),
			"error",
		);
	} finally {
		args.refreshStatus(args.ctx);
	}
}

async function pickDriverNavigator(
	ctx: ExtensionContext,
): Promise<{ driver: string; navigator: string } | undefined> {
	const snapshot = snapshotAvailableModels(ctx);
	if (snapshot.length < 2) {
		ctx.ui.notify(
			`Need at least 2 distinct models for pair-coding; have ${snapshot.length}.`,
			"error",
		);
		return undefined;
	}
	const driver = await pickModel(ctx, "Select Driver (coding model)", snapshot);
	if (!driver) return undefined;
	const remaining = snapshot.filter((m) => m !== driver);
	const navigator = await pickModel(ctx, "Select Navigator (review model)", remaining, {
		selected: [driver],
	});
	if (!navigator) return undefined;
	return { driver, navigator };
}

interface PairCommandRegistration {
	pi: ExtensionAPI;
	pairs: Map<string, PairDefinition>;
	refreshStatus: (ctx: ExtensionContext) => void;
}

export function registerPairCommands(args: PairCommandRegistration): void {
	const { pi, pairs, refreshStatus } = args;

	pi.registerCommand("pair-form", {
		description: "Form a named Driver/Navigator pair for the session",
		handler: async (rawArgs, ctx) => {
			const requested = rawArgs.trim();
			const name = requested || (await ctx.ui.input("Pair name", "review"));
			if (!name) return;

			const picked = await pickDriverNavigator(ctx);
			if (!picked) return;

			const purposeInput = await ctx.ui.input(
				"Purpose (optional)",
				"e.g. test scaffolding, refactor, review",
			);
			const purpose = purposeInput?.trim() || undefined;

			pairs.set(name, {
				name,
				driver: picked.driver,
				navigator: picked.navigator,
				purpose,
				createdAt: Date.now(),
			});
			refreshStatus(ctx);
			ctx.ui.notify(`Formed pair "${name}".`, "info");
		},
	});

	pi.registerCommand("pair-list", {
		description: "Show session pairs",
		handler: async (_rawArgs, ctx) => {
			if (pairs.size === 0) {
				ctx.ui.notify("No pairs formed in this session.", "warning");
				return;
			}
			ctx.ui.setWidget("council", ["Pairs", ...[...pairs.values()].map(pairLine)]);
		},
	});

	pi.registerCommand("pair", {
		description: "Run a pair-coding session (named or ad-hoc)",
		handler: async (rawArgs, ctx) => {
			const argsTrim = rawArgs.trim();
			const names = [...pairs.keys()].sort();
			const namedPair = argsTrim ? pairs.get(argsTrim) : undefined;

			let driver: string;
			let navigator: string;
			let inlinePrompt: string | undefined;

			if (namedPair) {
				// `/pair <name>` — selector consumed; ask for prompt
				driver = namedPair.driver;
				navigator = namedPair.navigator;
			} else if (names.length === 0) {
				// ad-hoc fallback
				const picked = await pickDriverNavigator(ctx);
				if (!picked) return;
				driver = picked.driver;
				navigator = picked.navigator;
				inlinePrompt = argsTrim || undefined;
			} else {
				const chosen =
					names.length === 1 ? names[0] : await ctx.ui.select("Pair", names);
				if (!chosen) return;
				const def = pairs.get(chosen);
				if (!def) {
					ctx.ui.notify(`No pair "${chosen}".`, "error");
					return;
				}
				driver = def.driver;
				navigator = def.navigator;
				inlinePrompt = argsTrim || undefined;
			}

			const promptInput = inlinePrompt ?? (await ctx.ui.editor("Coding task", ""));
			const prompt = promptInput?.trim();
			if (!prompt) return;

			await executePair({ prompt, driver, navigator, ctx, refreshStatus });
		},
	});

	pi.registerCommand("pair-dissolve", {
		description: "Remove a named pair from the session",
		handler: async (_rawArgs, ctx) => {
			const names = [...pairs.keys()].sort();
			if (names.length === 0) {
				ctx.ui.notify("No pairs to dissolve.", "warning");
				return;
			}
			const name = await ctx.ui.select("Dissolve pair", names);
			if (!name) return;
			const confirmed = await ctx.ui.confirm("Dissolve pair?", `Remove pair "${name}"?`);
			if (!confirmed) return;
			pairs.delete(name);
			refreshStatus(ctx);
			ctx.ui.notify(`Dissolved "${name}".`, "info");
		},
	});
}

