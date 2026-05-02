/**
 * `/teams` slash command registration and command flow.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { deleteTeamFiles } from "./team-form.js";
import { selectTeamModels } from "./team-models.js";
import { openTeamBrowserOverlay, openTeamOverlay, pickTeamId, teamDescriptionLines } from "./team-overlay.js";
import { formTeam } from "./team-form.js";
import { runTeam, type TeamRunRegistration } from "./team-runtime.js";

function parseRunArgs(rawArgs: string): { id: string; prompt: string } | undefined {
	const [id, ...rest] = rawArgs.trim().split(/\s+/);
	if (!id) return undefined;
	return { id, prompt: rest.join(" ").trim() };
}

async function deleteSelectedTeam(ctx: ExtensionContext, requested?: string): Promise<string | undefined> {
	const id = await pickTeamId(ctx, requested);
	if (!id) return undefined;
	const confirmed = await ctx.ui.confirm("Delete team?", `Delete/dissolve team "${id}"?`);
	if (!confirmed) return undefined;
	const result = deleteTeamFiles({ id }, ctx.cwd);
	ctx.ui.notify(`Deleted team "${result.id}"`, "info");
	return id;
}

export function registerTeamCommands(
	pi: ExtensionAPI,
	registration: TeamRunRegistration,
): void {
	pi.registerCommand("teams", {
		description: "Browse, describe, form, configure models, delete, or run teams. Usage: /teams [list|describe [id]|form [id]|models [id]|delete [id]|run [id] [prompt]]",
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
			const parsed = parseRunArgs(command === "run" ? rest.join(" ") : trimmed);
			const id = parsed?.id ?? await pickTeamId(ctx);
			if (!id) return;
			const promptInput = parsed?.prompt || await ctx.ui.editor("Team prompt", "");
			const prompt = promptInput?.trim() ?? "";
			if (!prompt) return;
			await ctx.waitForIdle();
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
