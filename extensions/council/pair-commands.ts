/**
 * Slash-command lifecycle for pair-coding sessions, plus the `pair_consult`
 * tool the main agent (the Pilot) uses to consult its Navigator.
 *
 *   /pair-form     — name + pick navigator + optional purpose
 *   /pair          — primer message that activates a pair for the conversation
 *   /pair-list     — show session pairs
 *   /pair-dissolve — confirm + remove a named pair
 *
 * Pilot is *this session's main agent* — the one with full tool access and
 * conversation context. Navigator is a separate model invoked by the agent
 * via the `pair_consult` tool whenever it wants outside review. Pairs are
 * session-local; no settings.json persistence.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { snapshotAvailableModels } from "./members.js";
import { navigatorReviewSystemPrompt } from "./pair-prompts.js";
import { pickModel } from "./picker.js";
import { runMember } from "./runner.js";

export interface PairDefinition {
	name: string;
	navigator: string;
	purpose?: string;
	createdAt: number;
}

function pairLine(p: PairDefinition): string {
	const purpose = p.purpose ? ` | ${p.purpose}` : "";
	return `- ${p.name}: navigator=${p.navigator}${purpose}`;
}

interface PairCommandRegistration {
	pi: ExtensionAPI;
	pairs: Map<string, PairDefinition>;
	refreshStatus: (ctx: ExtensionContext) => void;
}

const PairConsultSchema = Type.Object({
	pair: Type.Optional(
		Type.String({
			description: "Pair name (defaults to the only pair, or fails if multiple).",
		}),
	),
	message: Type.String({
		description:
			"Code, design question, test plan, or rough draft to share with the Navigator. Include enough context to make the review concrete.",
	}),
});

function pickPair(
	pairs: Map<string, PairDefinition>,
	requested?: string,
): PairDefinition | { error: string } {
	if (requested) {
		const def = pairs.get(requested);
		if (def) return def;
		return { error: `No pair "${requested}". Run /pair-form to set one up.` };
	}
	if (pairs.size === 0) {
		return { error: "No pair configured. Run /pair-form to set up a Navigator." };
	}
	if (pairs.size === 1) {
		return [...pairs.values()][0]!;
	}
	const names = [...pairs.keys()].sort();
	return {
		error: `Multiple pairs available (${names.join(", ")}). Pass pair="<name>" explicitly.`,
	};
}

function primerForPair(def: PairDefinition, task: string | undefined): string {
	const taskLine = task ? `\n\nTask: ${task}` : "";
	return [
		`[Pair-coding "${def.name}" — Navigator: ${def.navigator}]`,
		"",
		`You're the Pilot in a pair-coding session. Use the pair_consult tool with pair="${def.name}" whenever a Navigator review would help — typically before finalizing a non-trivial change. The Navigator runs ${def.navigator} in a fresh session; share the relevant code or design question plus a focused ask.${taskLine}`,
	].join("\n");
}

export function registerPairCommands(args: PairCommandRegistration): void {
	const { pi, pairs, refreshStatus } = args;

	pi.registerCommand("pair-form", {
		description: "Set up a Navigator for pair-coding (the main agent is the Pilot)",
		handler: async (rawArgs, ctx) => {
			const requested = rawArgs.trim();
			const name = requested || (await ctx.ui.input("Pair name", "review"));
			if (!name) return;

			const snapshot = snapshotAvailableModels(ctx);
			if (snapshot.length === 0) {
				ctx.ui.notify("No models available for the Navigator.", "error");
				return;
			}
			const navigator = await pickModel(ctx, "Select Navigator (review model)", snapshot);
			if (!navigator) return;

			const purposeInput = await ctx.ui.input(
				"Purpose (optional)",
				"e.g. design review, test scaffolding, refactor",
			);
			const purpose = purposeInput?.trim() || undefined;

			pairs.set(name, { name, navigator, purpose, createdAt: Date.now() });
			refreshStatus(ctx);
			ctx.ui.notify(`Pair "${name}" ready — navigator=${navigator}.`, "info");
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
		description: "Activate a pair for the current conversation",
		handler: async (rawArgs, ctx) => {
			if (pairs.size === 0) {
				ctx.ui.notify("No pairs formed. Run /pair-form first.", "warning");
				return;
			}
			const argsTrim = rawArgs.trim();
			const names = [...pairs.keys()].sort();
			const firstWord = argsTrim.split(/\s+/)[0] ?? "";
			let chosen: string | undefined;
			let inlineTask: string | undefined;

			if (firstWord && pairs.has(firstWord)) {
				chosen = firstWord;
				inlineTask = argsTrim.slice(firstWord.length).trim() || undefined;
			} else if (names.length === 1) {
				chosen = names[0];
				inlineTask = argsTrim || undefined;
			} else {
				chosen = await ctx.ui.select("Pair", names);
				inlineTask = argsTrim || undefined;
			}
			if (!chosen) return;
			const def = pairs.get(chosen);
			if (!def) {
				ctx.ui.notify(`No pair "${chosen}".`, "error");
				return;
			}
			pi.sendUserMessage(primerForPair(def, inlineTask), { deliverAs: "followUp" });
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

	pi.registerTool({
		name: "pair_consult",
		label: "Consult Navigator",
		description:
			"Send the Navigator a code draft, design question, or test plan and get its review back. Use whenever you'd benefit from an outside perspective before finalizing a non-trivial change.",
		promptSnippet: "Get review feedback from the paired Navigator model",
		parameters: PairConsultSchema,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const picked = pickPair(pairs, params.pair);
			if ("error" in picked) {
				return {
					content: [{ type: "text" as const, text: picked.error }],
					details: { error: picked.error },
				};
			}
			ctx.ui.setStatus("council", `pair: consulting ${picked.navigator}`);
			try {
				const run = await runMember(
					{ label: "Navigator", model: picked.navigator },
					{
						prompt: params.message,
						systemPrompt: navigatorReviewSystemPrompt(),
						cwd: ctx.cwd,
						signal: ctx.signal,
					},
				);
				const body = run.ok
					? run.output
					: `Navigator failed: ${run.error ?? "unknown error"}`;
				return {
					content: [{ type: "text" as const, text: body }],
					details: {
						pair: picked.name,
						navigator: picked.navigator,
						durationMs: run.durationMs,
						ok: run.ok,
					},
				};
			} finally {
				refreshStatus(ctx);
			}
		},
	});
}
