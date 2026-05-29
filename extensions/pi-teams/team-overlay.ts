/**
 * Team TUI overlay helpers.
 */

import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, type Component, type Focusable, fuzzyFilter, Input, matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { formatHiddenCountCue } from "../../lib/tui-overflow.js";
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

function deleteTeam(ctx: ExtensionContext, team: TeamSpec): boolean {
	try {
		const result = deleteTeamFiles({ id: team.id }, ctx.cwd);
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
		container.addChild(new Text(args.theme.fg("dim", " y confirm · n cancel · esc close"), 1, 0));
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

async function openTeamBrowserOnce(ctx: ExtensionContext): Promise<TeamBrowserAction | undefined> {
	let teams = loadTeams(ctx.cwd);
	if (teams.length === 0) {
		await openTeamOverlay(ctx, "Teams", ["No teams found."]);
		return undefined;
	}
	let selected = 0;
	let detailId: string | undefined;
	let deletingId: string | undefined;
	let searchActive = false;
	let focused = false;
	const searchInput = new Input();

	const displayedTeams = (): TeamSpec[] => {
		if (!searchActive) return teams;
		const query = searchInput.getValue().trim();
		if (!query) return teams;
		return fuzzyFilter(teams, query, (team) =>
			`${team.id} ${team.name} ${team.protocol} ${team.source} ${team.description ?? ""}`);
	};

	const selectedTeam = (): TeamSpec | undefined => {
		if (detailId) return teams.find((team) => team.id === detailId);
		return displayedTeams()[selected];
	};

	const reload = () => {
		teams = loadTeams(ctx.cwd);
		selected = 0;
		detailId = undefined;
		deletingId = undefined;
		searchActive = false;
		searchInput.setValue("");
		searchInput.focused = false;
	};

	return ctx.ui.custom<TeamBrowserAction | undefined>((tui, theme, _kb, done): Component & Focusable => ({
		get focused(): boolean {
			return focused;
		},
		set focused(value: boolean) {
			focused = value;
			searchInput.focused = value && searchActive;
		},
		render: (width: number) => renderTeamBrowserOverlay({
			teams,
			selected,
			theme,
			width,
			...(detailId ? { detailLines: teamDescriptionLines(ctx.cwd, detailId) } : {}),
			...(deletingId ? { deletingId } : {}),
			searchActive,
			searchInput,
			query: searchInput.getValue(),
		}),
		invalidate: () => searchInput.invalidate(),
		handleInput: (data: string) => {
			if (matchesKey(data, "escape")) {
				if (searchActive) {
					searchActive = false;
					searchInput.setValue("");
					searchInput.focused = false;
					selected = 0;
					tui.requestRender();
					return;
				}
				done(undefined);
				return;
			}
			if (deletingId) {
				if (data.toLowerCase() === "y") {
					const team = teams.find((entry) => entry.id === deletingId);
					if (team && deleteTeam(ctx, team)) reload();
					else deletingId = undefined;
					tui.requestRender();
					return;
				}
				if (data.toLowerCase() === "n") {
					deletingId = undefined;
					tui.requestRender();
				}
				return;
			}
			if (detailId) {
				if (matchesKey(data, "backspace") || matchesKey(data, "left")) {
					detailId = undefined;
					tui.requestRender();
				} else if (data.toLowerCase() === "f") {
					done({ type: "form" });
				} else if (data.toLowerCase() === "m") {
					done({ type: "models", id: detailId });
				} else if (data.toLowerCase() === "d") {
					const team = teams.find((entry) => entry.id === detailId);
					if (team) {
						if (team.source === "builtin") {
							ctx.ui.notify("Built-in teams cannot be deleted from the overlay", "warning");
						} else {
							deletingId = detailId;
							tui.requestRender();
						}
					}
				}
				return;
			}

			// Search/filter mode
			if (searchActive) {
				if (matchesKey(data, "up") && selected > 0) {
					selected--;
					tui.requestRender();
					return;
				}
				if (matchesKey(data, "down")) {
					const visible = displayedTeams();
					if (selected < visible.length - 1) {
						selected++;
						tui.requestRender();
					}
					return;
				}
				if (matchesKey(data, "return") || matchesKey(data, "enter")) {
					const visible = displayedTeams();
					if (visible.length > 0) {
						detailId = visible[selected]?.id;
						tui.requestRender();
					}
					return;
				}
				searchInput.handleInput(data);
				selected = Math.min(selected, Math.max(displayedTeams().length - 1, 0));
				tui.requestRender();
				return;
			}

			// Browse mode (f/m/d are inactive during search; they type into the filter input instead)
			if (data === "/") {
				searchActive = true;
				searchInput.setValue("");
				searchInput.focused = focused;
				tui.requestRender();
				return;
			}
			if (data.toLowerCase() === "f") {
				done({ type: "form" });
				return;
			}
			if (data.toLowerCase() === "m") {
				const team = selectedTeam();
				if (!team) return;
				done({ type: "models", id: team.id });
				return;
			}
			if (data.toLowerCase() === "d") {
				const team = selectedTeam();
				if (!team) return;
				if (team.source === "builtin") {
					ctx.ui.notify("Built-in teams cannot be deleted from the overlay", "warning");
					return;
				}
				deletingId = team.id;
				tui.requestRender();
				return;
			}
			if (matchesKey(data, "up") && selected > 0) {
				selected--;
				tui.requestRender();
				return;
			}
			if (matchesKey(data, "down") && selected < displayedTeams().length - 1) {
				selected++;
				tui.requestRender();
				return;
			}
			if (matchesKey(data, "return") || matchesKey(data, "enter")) {
				const visible = displayedTeams();
				detailId = visible[selected]?.id;
				tui.requestRender();
			}
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
