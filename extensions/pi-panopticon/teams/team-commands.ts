/**
 * `/teams` slash command registration and command flow.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { confirmDestructiveAction, type DestructiveConfirmationView } from "../../../lib/tui-confirmation.js";
import { deleteTeamFiles } from "./team-form.js";
import { selectTeamModels } from "./team-models.js";
import { openTeamBrowserOverlay, openTeamOverlay, pickTeamId, teamDescriptionLines } from "./team-overlay.js";
import { formTeam } from "./team-form.js";
import { projectBuiltinTeams, pruneBuiltinTeams } from "./team-projection.js";
import { runTeam, type TeamRunRegistration } from "./team-runtime.js";

function parseRunArgs(rawArgs: string): { id: string; prompt: string } | undefined {
	const [id, ...rest] = rawArgs.trim().split(/\s+/);
	if (!id) return undefined;
	return { id, prompt: rest.join(" ").trim() };
}

export function teamDeleteConfirmationView(id: string): DestructiveConfirmationView {
	return {
		title: "Delete team?",
		subject: `Delete/dissolve team "${id}"?`,
		details: ["Removes the user or project team files; built-in teams are protected."],
		severity: "warning",
	};
}

function teamSeedForceConfirmationView(): DestructiveConfirmationView {
	return {
		title: "Re-project built-in teams with --force?",
		subject: "Overwrite all user-scope built-in team files with fresh seed copies?",
		details: ["This replaces your editable copies of built-in teams (e.g. llm-council, navigator) with the packaged seeds. Custom teams you created are not affected."],
		severity: "warning",
	};
}

function teamPruneConfirmationView(): DestructiveConfirmationView {
	return {
		title: "Prune stale built-in teams?",
		subject: "Remove user-scope files for team ids no longer shipped as built-in seeds?",
		details: ["Only files created by built-in seed projection are removed. Custom teams you created are preserved."],
		severity: "warning",
	};
}

async function pruneBuiltinTeamsCmd(ctx: ExtensionContext): Promise<void> {
	const result = await pruneBuiltinTeams(ctx);
	ctx.ui.notify(`Team prune: removed ${result.removed.length} stale seed(s)${result.removed.length > 0 ? `: ${result.removed.join(", ")}` : ""}`, "info");
}

async function seedBuiltinTeams(ctx: ExtensionContext, rawArgs: string): Promise<void> {
	const force = /(?:^|\s)--force(?:\s|$)/.test(rawArgs);
	if (force) {
		const confirmed = await confirmDestructiveAction(ctx, teamSeedForceConfirmationView());
		if (!confirmed) return;
	}
	const result = await projectBuiltinTeams(ctx, { force });
	const parts: string[] = [];
	if (result.projected.length > 0) parts.push(`projected ${result.projected.length}: ${result.projected.join(", ")}`);
	if (result.overwritten.length > 0) parts.push(`overwritten ${result.overwritten.length}: ${result.overwritten.join(", ")}`);
	if (result.skipped.length > 0) parts.push(`skipped ${result.skipped.length} (already present)`);
	ctx.ui.notify(`Team seed${force ? " (force)" : ""}: ${parts.join(" · ") || "no changes"}`, "info");
}

async function deleteSelectedTeam(ctx: ExtensionContext, requested?: string): Promise<string | undefined> {
	const id = await pickTeamId(ctx, requested);
	if (!id) return undefined;
	const confirmed = await confirmDestructiveAction(ctx, teamDeleteConfirmationView(id));
	if (!confirmed) return undefined;
	const result = await deleteTeamFiles({ id }, ctx.cwd);
	ctx.ui.notify(`Deleted team "${result.id}"`, "info");
	return id;
}

export function registerTeamCommands(
	pi: ExtensionAPI,
	registration: TeamRunRegistration,
): void {
	pi.registerCommand("teams", {
		description: "Browse, describe, form, configure models, delete, seed, prune, or run teams. Usage: /teams [list|describe [id]|form [id]|models [id]|delete [id]|seed [--force]|prune|run [id] [prompt]|async [id] [prompt]]",
		handler: async (rawArgs, ctx) => {
			const trimmed = rawArgs.trim();
			if (!trimmed || trimmed === "list") {
				await openTeamBrowserOverlay(ctx);
				return;
			}
			const [command, ...rest] = trimmed.split(/\s+/);
			if (command === "describe" || command === "describ") {
				const picked = await pickTeamId(ctx, rest[0]);
				if (!picked) return;
				await openTeamOverlay(ctx, "Team Detail", teamDescriptionLines(ctx.cwd, picked));
				return;
			}
			if (command === "form") {
				const id = await formTeam(ctx, rest.join(" ").trim() || undefined);
				if (!id) return;
				await openTeamOverlay(ctx, "Team Created", teamDescriptionLines(ctx.cwd, id));
				return;
			}
			if (command === "models") {
				const id = await selectTeamModels(ctx, rest[0]);
				if (!id) return;
				await openTeamOverlay(ctx, "Team Models Updated", teamDescriptionLines(ctx.cwd, id));
				return;
			}
			if (command === "delete" || command === "dissolve") {
				await deleteSelectedTeam(ctx, rest[0]);
				return;
			}
			if (command === "seed") {
				await seedBuiltinTeams(ctx, rest.join(" "));
				return;
			}
			if (command === "prune") {
				const confirmed = await confirmDestructiveAction(ctx, teamPruneConfirmationView());
				if (!confirmed) return;
				await pruneBuiltinTeamsCmd(ctx);
				return;
			}
			const isAsyncRun = command === "async";
			const parsed = parseRunArgs(command === "run" || isAsyncRun ? rest.join(" ") : trimmed);
			const id = parsed?.id ?? await pickTeamId(ctx);
			if (!id) return;
			const promptInput = parsed?.prompt || await ctx.ui.editor("Team prompt", "");
			const prompt = promptInput?.trim() ?? "";
			if (!prompt) return;
			await ctx.waitForIdle();
			if (isAsyncRun) {
				void runTeam({
					params: { id, prompt },
					ctx,
					stateManager: registration.stateManager,
				}).then((result) => {
					const text = result.content.map((entry) => entry.text).join("\n");
					pi.sendUserMessage(`[Team "${id}" async result]\n\n${text}`, { deliverAs: "followUp" });
				}).catch((error: unknown) => {
					pi.sendUserMessage(`[Team "${id}" async failed]\n\n${error instanceof Error ? error.message : String(error)}`, { deliverAs: "followUp" });
				});
				ctx.ui.notify(`Team "${id}" started asynchronously`, "info");
				return;
			}
			const result = await runTeam({
				params: { id, prompt },
				ctx,
				stateManager: registration.stateManager,
			});
			const text = result.content.map((entry) => entry.text).join("\n");
			pi.sendUserMessage(`[Team "${id}" result]\n\n${text}`, {
				deliverAs: "followUp",
			});
		},
	});
}
