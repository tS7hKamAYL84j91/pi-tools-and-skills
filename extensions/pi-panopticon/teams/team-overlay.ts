/**
 * Team TUI overlay helpers.
 */

import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, type Component, type Focusable, fuzzyFilter, Input, matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { formatHiddenCountCue } from "../../../lib/tui-overflow.js";
import { deleteTeamFiles, formTeam } from "./team-form.js";
import { selectTeamModels } from "./team-models.js";
import { STATUS_SYMBOLS } from "./status-symbols.js";
import { loadTeamRegistry } from "./team-registry.js";
import type { TeamSpec } from "./team-types.js";

export function teamDescriptionLines(cwd: string, id: string): string[] {
	const registry = loadTeamRegistry(undefined, { cwd });
	const team = registry.teams.get(id);
	if (!team) {
		throw new Error(
			`No team "${id}". Known: ${[...registry.teams.keys()].join(", ") || "(none)"}`,
		);
	}
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
	| { type: "models"; id: string };

const MAX_READ_ONLY_DETAIL_LINES = 15;

function readOnlyDetailLines(lines: readonly string[]): string[] {
	if (lines.length <= MAX_READ_ONLY_DETAIL_LINES) return [...lines];
	const visibleCount = MAX_READ_ONLY_DETAIL_LINES - 1;
	const hiddenCount = lines.length - visibleCount;
	const hiddenCue = formatHiddenCountCue(hiddenCount, "line");
	if (!hiddenCue) return [...lines.slice(0, visibleCount)];
	return [
		...lines.slice(0, visibleCount),
		hiddenCue,
	];
}

interface RenderTeamBrowserArgs {
	teams: TeamSpec[];
	selected: number;
	theme: Theme;
	width: number;
	detailLines?: string[];
	deletingId?: string;
	searchActive?: boolean;
	searchInput?: Component;
	query?: string;
}

export function renderTeamBrowserOverlay(args: RenderTeamBrowserArgs): string[] {
	const container = new Container();
	const border = () => new DynamicBorder((s: string) => args.theme.fg("accent", s));
	container.addChild(border());
	container.addChild(new Text(args.theme.fg("accent", args.theme.bold(args.detailLines ? " Team Detail" : " Teams")), 1, 0));
	if (args.deletingId) {
		container.addChild(new Text(`Delete team "${args.deletingId}"?`, 1, 0));
		container.addChild(new Text(args.theme.fg("dim", " [y] confirm · [esc/n] cancel"), 1, 0));
	} else if (args.detailLines) {
		for (const line of readOnlyDetailLines(args.detailLines)) {
			container.addChild(new Text(line, 1, 0));
		}
		container.addChild(new Text(args.theme.fg("dim", " f form · m models · d delete · backspace back · esc close"), 1, 0));
	} else {
		const visible = args.searchActive && args.query
			? fuzzyFilter(args.teams, args.query.trim(), (team) =>
				`${team.id} ${team.name} ${team.protocol} ${team.source} ${team.description ?? ""}`)
			: args.teams;
		const selected = Math.min(args.selected, Math.max(visible.length - 1, 0));

		if (args.searchActive && args.searchInput) {
			container.addChild(args.searchInput);
		}

		if (visible.length === 0) {
			container.addChild(new Text(args.theme.fg("dim", " No matching teams."), 1, 0));
		} else {
			for (const [index, team] of visible.entries()) {
				const prefix = index === selected ? `${STATUS_SYMBOLS.selection} ` : "  ";
				const content = truncateToWidth(`${team.id} · ${team.name} · ${team.protocol} · ${team.source}`, Math.max(18, args.width - 6));
				container.addChild(new Text(index === selected ? `${prefix}${args.theme.fg("accent", args.theme.bold(content))}` : `${prefix}${content}`, 1, 0));
			}
		}

		const description = visible[selected]?.description;
		if (description) container.addChild(new Text(args.theme.fg("dim", truncateToWidth(description, Math.max(20, args.width - 4))), 1, 0));

		if (args.searchActive) {
			container.addChild(new Text(args.theme.fg("dim", " type to filter · ↑/↓ navigate · enter detail · esc close"), 1, 0));
		} else {
			container.addChild(new Text(args.theme.fg("dim", " ↑/↓ navigate · enter detail · f form · m models · d delete · / filter · esc close"), 1, 0));
		}
	}
	container.addChild(border());
	return container.render(args.width);
}

export function renderTeamOverlay(title: string, lines: string[], theme: Theme, width: number): string[] {
	const container = new Container();
	const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));
	container.addChild(border());
	container.addChild(new Text(theme.fg("accent", theme.bold(` ${title}`)), 1, 0));
	for (const line of readOnlyDetailLines(lines)) {
		container.addChild(new Text(line, 1, 0));
	}
	container.addChild(new Text(theme.fg("dim", " esc close"), 1, 0));
	container.addChild(border());
	return container.render(width);
}

class TeamBrowserState {
	teams: TeamSpec[];
	selected = 0;
	detailId: string | undefined;
	deletingId: string | undefined;
	searchActive = false;
	focused = false;
	searchInput = new Input();

	constructor(
		private ctx: ExtensionContext,
		private tui: { requestRender: () => void },
		private done: (action: TeamBrowserAction | undefined) => void,
	) {
		this.teams = loadTeams(ctx.cwd);
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
		if (data.toLowerCase() === "y") {
			const team = this.teams.find((entry) => entry.id === this.deletingId);
			if (team && await deleteTeam(this.ctx, team)) this.reload();
			else this.deletingId = undefined;
			this.tui.requestRender();
			return;
		}
		if (data.toLowerCase() === "n") {
			this.deletingId = undefined;
			this.tui.requestRender();
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
		if (matchesKey(data, "escape")) {
			this.handleEscape();
			return;
		}
		if (this.deletingId) {
			await this.handleDeleteConfirmation(data);
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

async function openTeamBrowserOnce(ctx: ExtensionContext): Promise<TeamBrowserAction | undefined> {
	const teams = loadTeams(ctx.cwd);
	if (teams.length === 0) {
		await openTeamOverlay(ctx, "Teams", ["No teams found."]);
		return undefined;
	}

	return ctx.ui.custom<TeamBrowserAction | undefined>((tui, theme, _kb, done): Component & Focusable => {
		const state = new TeamBrowserState(ctx, tui, done);

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
				theme,
				width,
				...(state.detailId ? { detailLines: teamDescriptionLines(ctx.cwd, state.detailId) } : {}),
				...(state.deletingId ? { deletingId: state.deletingId } : {}),
				searchActive: state.searchActive,
				searchInput: state.searchInput,
				query: state.searchInput.getValue(),
			}),
			invalidate: () => state.searchInput.invalidate(),
			handleInput: (data: string) => state.handleInput(data),
		};
	}, {
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

export async function openTeamBrowserOverlay(ctx: ExtensionContext): Promise<void> {
	let action = await openTeamBrowserOnce(ctx);
	while (action) {
		if (action.type === "form") {
			const id = await formTeam(ctx);
			if (id) await openTeamOverlay(ctx, "Team Created", teamDescriptionLines(ctx.cwd, id));
		} else {
			await selectTeamModels(ctx, action.id);
		}
		action = await openTeamBrowserOnce(ctx);
	}
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
