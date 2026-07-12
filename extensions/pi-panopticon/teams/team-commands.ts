/**
 * `/teams` slash command registration and command flow.
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { RuntimeControlPlane } from "../../../lib/runtime-control-plane.js";
import { confirmDestructiveAction, type DestructiveConfirmationView } from "../../../lib/tui-confirmation.js";
import { deleteTeamFiles } from "./team-form.js";
import { selectTeamModels } from "./team-models.js";
import { openTeamBrowserOverlay, openTeamOverlay, pickTeamId, teamDescriptionLines } from "./team-overlay.js";
import { formTeam } from "./team-form.js";
import { projectBuiltinTeams, pruneBuiltinTeams } from "./team-projection.js";
import { isTeamProfile, type TeamProfile } from "./team-profiles.js";
import { requestTeamRunStop, runTeam, type TeamRunRegistration } from "./team-runtime.js";

interface ParsedTeamRunArgs {
	id?: string;
	prompt: string;
	profile: TeamProfile;
}

export function parseTeamRunArgs(rawArgs: string): ParsedTeamRunArgs {
	const tokens = rawArgs.trim() ? rawArgs.trim().split(/\s+/) : [];
	const positional: string[] = [];
	let profile: TeamProfile = "balanced";
	let profileSeen = false;
	let parseOptions = true;
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (!token) continue;
		if (parseOptions && token === "--") {
			parseOptions = false;
			continue;
		}
		if (parseOptions && (token === "--profile" || token.startsWith("--profile="))) {
			if (profileSeen) throw new Error("--profile may be specified only once");
			const value = token === "--profile" ? tokens[++index] : token.slice("--profile=".length);
			if (!value || !isTeamProfile(value)) {
				throw new Error("--profile must be fast, balanced, or thorough");
			}
			profile = value;
			profileSeen = true;
			continue;
		}
		positional.push(token);
	}
	const [id, ...promptParts] = positional;
	return {
		...(id ? { id } : {}),
		prompt: promptParts.join(" ").trim(),
		profile,
	};
}

interface ExecuteTeamRunArgs {
	pi: ExtensionAPI;
	registration: TeamRunRegistration;
	ctx: ExtensionCommandContext;
	request: { id: string; prompt: string; profile: TeamProfile };
	asyncRun: boolean;
}

async function executeTeamRun(args: ExecuteTeamRunArgs): Promise<void> {
	const { pi, registration, ctx, request, asyncRun } = args;
	await ctx.waitForIdle();
	ctx.ui.notify(`Running team "${request.id}" with profile=${request.profile}${asyncRun ? " asynchronously" : ""}`, "info");
	if (asyncRun) {
		void runTeam({
			params: request,
			ctx,
			stateManager: registration.stateManager,
		}).then((result) => {
			const text = result.content.map((entry) => entry.text).join("\n");
			pi.sendUserMessage(`[Team "${request.id}" async result · profile=${request.profile}]\n\n${text}`, { deliverAs: "followUp" });
		}).catch((error: unknown) => {
			pi.sendUserMessage(`[Team "${request.id}" async failed · profile=${request.profile}]\n\n${error instanceof Error ? error.message : String(error)}`, { deliverAs: "followUp" });
		});
		return;
	}
	const result = await runTeam({
		params: request,
		ctx,
		stateManager: registration.stateManager,
	});
	const text = result.content.map((entry) => entry.text).join("\n");
	pi.sendUserMessage(`[Team "${request.id}" result · profile=${request.profile}]\n\n${text}`, {
		deliverAs: "followUp",
	});
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
	const runtime = registration.runtime ?? new RuntimeControlPlane();
	pi.registerCommand("teams", {
		description: "Browse, configure, run, or stop teams. Usage: /teams [list|describe [id]|form [id]|models [id]|delete [id]|seed [--force]|prune|stop [runId]|run [id] [prompt] [--profile fast|balanced|thorough]|async [id] [prompt] [--profile fast|balanced|thorough]]",
		handler: async (rawArgs, ctx) => {
			const trimmed = rawArgs.trim();
			if (!trimmed || trimmed === "list") {
				const request = await openTeamBrowserOverlay(ctx);
				if (request) await executeTeamRun({ pi, registration, ctx, request, asyncRun: false });
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
			if (command === "stop") {
				const result = requestTeamRunStop(registration.stateManager, runtime, rest[0], "stop requested from /teams");
				ctx.ui.notify(result.content[0]?.text ?? "Team run stopping", "info");
				return;
			}
			const isAsyncRun = command === "async";
			const parsed = parseTeamRunArgs(command === "run" || isAsyncRun ? rest.join(" ") : trimmed);
			const id = parsed.id ?? await pickTeamId(ctx);
			if (!id) return;
			const promptInput = parsed.prompt || await ctx.ui.editor(`Run ${id} (${parsed.profile})`, "");
			const prompt = promptInput?.trim() ?? "";
			if (!prompt) return;
			await executeTeamRun({
				pi,
				registration: { ...registration, runtime },
				ctx,
				request: { id, prompt, profile: parsed.profile },
				asyncRun: isAsyncRun,
			});
		},
	});
}
