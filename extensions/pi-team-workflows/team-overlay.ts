/**
 * Team TUI overlay helpers.
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type Focusable, fuzzyFilter, Input, matchesKey } from "@earendil-works/pi-tui";
import { deleteTeamFiles, formTeam } from "./team-form.js";
import { selectTeamModels } from "./team-models.js";
import { renderTeamBrowserOverlay, renderTeamOverlay } from "./team-overlay-render.js";
import { chooseTeamProfile } from "./team-picker.js";
import type { TeamProfile } from "./team-profiles.js";
import { loadTeamRegistry } from "./team-registry.js";
import type { TeamSpec } from "./team-types.js";

function descriptionLinesForTeam(team: TeamSpec): string[] {
	const bindingLines = team.agentBindings.map((binding) => {
		const model = binding.model ? ` model=${binding.model}` : "";
		return `  - ${binding.role}: ${binding.subagent}${model}`;
	});
	return [
		`${team.name} (${team.id})`,
		`Source: ${team.source}`,
		`Protocol: ${team.protocol}`,
		...(team.description ? [`Description: ${team.description}`] : []),
		`Agents: ${team.agents.join(", ") || "(none)"}`,
		...(bindingLines.length > 0 ? ["Agent bindings:", ...bindingLines] : []),
	];
}
export function teamDescriptionLines(cwd: string, id: string): string[] {
	const registry = loadTeamRegistry(undefined, { cwd });
	const team = registry.teams.get(id);
	if (!team) {
		throw new Error(
			`No team "${id}". Known: ${[...registry.teams.keys()].join(", ") || "(none)"}`,
		);
	}
	return descriptionLinesForTeam(team);
}
function teamIds(cwd: string): string[] {
	return [...loadTeamRegistry(undefined, { cwd }).teams.keys()].sort();
}

export async function pickTeamId(ctx: ExtensionContext, requested?: string): Promise<string | undefined> {
	if (requested) return requested;
	const ids = teamIds(ctx.cwd);
	if (ids.length === 0) {
		ctx.ui.notify("No teams found", "warning");
		return undefined;
	}
	if (ids.length === 1) return ids[0];
	return ctx.ui.select("Team", ids);
}
function loadTeams(cwd: string): TeamSpec[] {
	return [...loadTeamRegistry(undefined, { cwd }).teams.values()]
		.sort((a, b) => a.id.localeCompare(b.id));
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function deleteTeam(ctx: ExtensionContext, team: TeamSpec): Promise<boolean> {
	try {
		const result = await deleteTeamFiles({ id: team.id }, ctx.cwd);
		ctx.ui.notify(`Deleted team "${result.id}"`, "info");
		return true;
	} catch (error) {
		ctx.ui.notify(errorMessage(error), "warning");
		return false;
	}
}
type TeamBrowserAction =
	| { type: "form" }
	| { type: "models"; id: string }
	| { type: "run"; id: string };

interface TeamBrowserRunRequest {
	id: string;
	profile: TeamProfile;
	prompt: string;
}
export { renderTeamBrowserOverlay, renderTeamOverlay };

class TeamBrowserState {
	teams: TeamSpec[];
	selected = 0;
	detailId: string | undefined;
	deletingId: string | undefined;
	searchActive = false;
	focused = false;
	searchInput = new Input();
	private detailLinesById: Map<string, string[]>;

	constructor(
		private ctx: ExtensionContext,
		private tui: { requestRender: () => void },
		private done: (action: TeamBrowserAction | undefined) => void,
		teams: TeamSpec[],
	) {
		this.teams = teams;
		this.detailLinesById = new Map(teams.map((team) => [team.id, descriptionLinesForTeam(team)]));
	}
	get detailLines(): string[] | undefined {
		return this.detailId ? this.detailLinesById.get(this.detailId) : undefined;
	}
	get displayedTeams(): TeamSpec[] {
		if (!this.searchActive) return this.teams;
		const query = this.searchInput.getValue().trim();
		if (!query) return this.teams;
		return fuzzyFilter(this.teams, query, (team) =>
			`${team.id} ${team.name} ${team.protocol} ${team.source} ${team.description ?? ""}`);
	}
	get selectedTeam(): TeamSpec | undefined {
		if (this.detailId) return this.teams.find((team) => team.id === this.detailId);
		return this.displayedTeams[this.selected];
	}
	reload() {
		this.teams = loadTeams(this.ctx.cwd);
		this.detailLinesById = new Map(this.teams.map((team) => [team.id, descriptionLinesForTeam(team)]));
		this.selected = 0;
		this.detailId = undefined;
		this.deletingId = undefined;
		this.searchActive = false;
		this.searchInput.setValue("");
		this.searchInput.focused = false;
	}
	private handleEscape() {
		if (this.searchActive) {
			this.searchActive = false;
			this.searchInput.setValue("");
			this.searchInput.focused = false;
			this.selected = 0;
			this.tui.requestRender();
			return;
		}
		this.done(undefined);
	}
	private async handleDeleteConfirmation(data: string) {
		if (matchesKey(data, "escape") || data.toLowerCase() === "n") {
			this.deletingId = undefined;
			this.tui.requestRender();
			return;
		}
		if (data.toLowerCase() === "y") {
			const team = this.teams.find((entry) => entry.id === this.deletingId);
			if (team && await deleteTeam(this.ctx, team)) this.reload();
			else this.deletingId = undefined;
			this.tui.requestRender();
			return;
		}
	}
	private handleDetailMode(data: string) {
		if (matchesKey(data, "backspace") || matchesKey(data, "left")) {
			this.detailId = undefined;
			this.tui.requestRender();
		} else if (data.toLowerCase() === "f") {
			this.done({ type: "form" });
		} else if (data.toLowerCase() === "m") {
			if (this.detailId) this.done({ type: "models", id: this.detailId });
		} else if (data.toLowerCase() === "r") {
			if (this.detailId) this.done({ type: "run", id: this.detailId });
		} else if (data.toLowerCase() === "d") {
			const team = this.teams.find((entry) => entry.id === this.detailId);
			if (team) {
				if (team.source === "builtin") {
					this.ctx.ui.notify("Built-in teams cannot be deleted from the overlay", "warning");
				} else {
					this.deletingId = this.detailId;
					this.tui.requestRender();
				}
			}
		}
	}
	private handleSearchMode(data: string) {
		if (matchesKey(data, "up") && this.selected > 0) {
			this.selected--;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "down")) {
			const visible = this.displayedTeams;
			if (this.selected < visible.length - 1) {
				this.selected++;
				this.tui.requestRender();
			}
			return;
		}
		if (matchesKey(data, "return") || matchesKey(data, "enter")) {
			const visible = this.displayedTeams;
			if (visible.length > 0) {
				this.detailId = visible[this.selected]?.id;
				this.searchActive = false;
				this.searchInput.focused = false;
				this.tui.requestRender();
			}
			return;
		}
		this.searchInput.handleInput(data);
		this.selected = Math.min(this.selected, Math.max(this.displayedTeams.length - 1, 0));
		this.tui.requestRender();
	}
	private handleBrowseMode(data: string) {
		if (data === "/") {
			this.searchActive = true;
			this.searchInput.setValue("");
			this.searchInput.focused = this.focused;
			this.tui.requestRender();
			return;
		}
		if (data.toLowerCase() === "f") {
			this.done({ type: "form" });
			return;
		}
		if (data.toLowerCase() === "m") {
			const team = this.selectedTeam;
			if (!team) return;
			this.done({ type: "models", id: team.id });
			return;
		}
		if (data.toLowerCase() === "r") {
			const team = this.selectedTeam;
			if (!team) return;
			this.done({ type: "run", id: team.id });
			return;
		}
		if (data.toLowerCase() === "d") {
			const team = this.selectedTeam;
			if (!team) return;
			if (team.source === "builtin") {
				this.ctx.ui.notify("Built-in teams cannot be deleted from the overlay", "warning");
				return;
			}
			this.deletingId = team.id;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "up") && this.selected > 0) {
			this.selected--;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "down") && this.selected < this.displayedTeams.length - 1) {
			this.selected++;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "return") || matchesKey(data, "enter")) {
			const visible = this.displayedTeams;
			this.detailId = visible[this.selected]?.id;
			this.tui.requestRender();
		}
	}
	async handleInput(data: string) {
		if (this.deletingId) {
			await this.handleDeleteConfirmation(data);
			return;
		}
		if (matchesKey(data, "escape")) {
			this.handleEscape();
			return;
		}
		if (this.detailId) {
			this.handleDetailMode(data);
			return;
		}
		if (this.searchActive) {
			this.handleSearchMode(data);
			return;
		}
		this.handleBrowseMode(data);
	}
}

interface CreateTeamBrowserComponentArgs {
	ctx: ExtensionContext;
	tui: { requestRender: () => void };
	theme: Theme;
	done: (action: TeamBrowserAction | undefined) => void;
	teams: TeamSpec[];
}
export function createTeamBrowserComponent(args: CreateTeamBrowserComponentArgs): Component & Focusable {
	const state = new TeamBrowserState(args.ctx, args.tui, args.done, args.teams);
	return {
		get focused(): boolean {
			return state.focused;
		},
		set focused(value: boolean) {
			state.focused = value;
			state.searchInput.focused = value && state.searchActive;
		},
		render: (width: number) => renderTeamBrowserOverlay({
			teams: state.teams,
			selected: state.selected,
			theme: args.theme,
			width,
			...(state.detailLines ? { detailLines: state.detailLines } : {}),
			...(state.deletingId ? { deletingId: state.deletingId } : {}),
			searchActive: state.searchActive,
			searchInput: state.searchInput,
			query: state.searchInput.getValue(),
		}),
		invalidate: () => state.searchInput.invalidate(),
		handleInput: (data: string) => state.handleInput(data),
	};
}

async function openTeamBrowserOnce(ctx: ExtensionContext): Promise<TeamBrowserAction | undefined> {
	const teams = loadTeams(ctx.cwd);
	if (teams.length === 0) {
		await openTeamOverlay(ctx, "Teams", ["No teams found."]);
		return undefined;
	}

	return ctx.ui.custom<TeamBrowserAction | undefined>((tui, theme, _kb, done) =>
		createTeamBrowserComponent({ ctx, tui, theme, done, teams }), {
		overlay: true,
		overlayOptions: {
			width: "70%",
			minWidth: 60,
			maxHeight: "80%",
			anchor: "center",
			margin: 2,
		},
	});
}

export async function openTeamBrowserOverlay(ctx: ExtensionContext): Promise<TeamBrowserRunRequest | undefined> {
	let action = await openTeamBrowserOnce(ctx);
	while (action) {
		if (action.type === "form") {
			const id = await formTeam(ctx);
			if (id) await openTeamOverlay(ctx, "Team Created", teamDescriptionLines(ctx.cwd, id));
		} else if (action.type === "models") {
			await selectTeamModels(ctx, action.id);
		} else {
			const profile = await chooseTeamProfile(ctx, action.id);
			if (profile) {
				const promptInput = await ctx.ui.editor(`Run ${action.id} (${profile})`, "");
				const prompt = promptInput?.trim();
				if (prompt) return { id: action.id, profile, prompt };
			}
		}
		action = await openTeamBrowserOnce(ctx);
	}
	return undefined;
}

export async function openTeamOverlay(
	ctx: ExtensionContext,
	title: string,
	lines: string[],
): Promise<void> {
	await ctx.ui.custom<void>((_tui, theme, _kb, done) => ({
		render: (width: number) => renderTeamOverlay(title, lines, theme, width),
		invalidate: () => undefined,
		handleInput: (data: string) => {
			if (matchesKey(data, "escape")) done();
		},
	}), {
		overlay: true,
		overlayOptions: {
			width: "70%",
			minWidth: 60,
			maxHeight: "80%",
			anchor: "center",
			margin: 2,
		},
	});
}
