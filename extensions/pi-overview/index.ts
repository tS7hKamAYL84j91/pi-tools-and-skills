/**
 * pi-overview extension entrypoint.
 *
 * Adds one read-only command to the existing TUI session: /overview shows the
 * project's git state, recent commits, session/model, and context usage. It
 * does not render chat, own the terminal, spawn a process, or change anything.
 */
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import {
	gatherProjectSnapshot,
	type OverviewFacts,
	overviewLines,
	type ProjectSnapshot,
	summaryLine,
} from "./snapshot.js";

function modelLabel(model: { provider?: string; id?: string } | undefined): string | undefined {
	if (model === undefined) return undefined;
	if (model.id === undefined) return undefined;
	return model.provider === undefined ? model.id : `${model.provider}/${model.id}`;
}

function factsFor(ctx: ExtensionCommandContext): OverviewFacts {
	return {
		sessionName: ctx.sessionManager.getSessionName(),
		modelLabel: modelLabel(ctx.model),
		context: ctx.getContextUsage(),
		entries: ctx.sessionManager.getEntries().length,
		idle: ctx.isIdle(),
	};
}

function overlayComponent(
	snapshot: ProjectSnapshot,
	facts: OverviewFacts,
	theme: Theme,
	done: () => void,
) {
	return {
		render: (width: number) => overviewLines(snapshot, facts, width, theme),
		invalidate: () => {},
		handleInput: (data: string) => {
			if (matchesKey(data, "escape") || matchesKey(data, "enter") || matchesKey(data, "return")) {
				done();
			}
		},
	};
}

export default function overviewExtension(pi: ExtensionAPI): void {
	pi.registerCommand("overview", {
		description:
			"Show a read-only project overview: git branch, uncommitted changes, recent commits, session/model, context usage, decision count.",
		handler: async (_args, ctx) => {
			const snapshot = gatherProjectSnapshot(ctx.cwd);
			const facts = factsFor(ctx);

			// Headless / RPC: no overlay is available, so report one bounded line.
			if (ctx.mode !== "tui" || !ctx.hasUI) {
				ctx.ui.notify(summaryLine(snapshot), "info");
				return;
			}

			await ctx.ui.custom<string | null>(
				(_tui, theme, _keybindings, done) => {
					const close = () => done(null);
					return overlayComponent(snapshot, facts, theme, close);
				},
				{
					overlay: true,
					overlayOptions: {
						width: "80%",
						minWidth: 60,
						maxHeight: "80%",
						anchor: "center",
						margin: 2,
					},
				},
			);
		},
	});
}
