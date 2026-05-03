/**
 * Team TUI overlay helpers.
 */

import { DynamicBorder, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Container, matchesKey, Text } from "@mariozechner/pi-tui";
import { deleteTeamFiles } from "./team-form.js";
import { selectTeamModels } from "./team-models.js";
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
		`Topology: ${team.topology}`,
		`Protocol: ${team.protocol}`,
		...(team.description ? [`Description: ${team.description}`] : []),
		`Agents: ${team.agents.join(", ") || "(none)"}`,
		...(bindingLines.length > 0 ? ["Agent bindings:", ...bindingLines] : []),
		...(team.chair ? [`Chair: ${team.chair}`] : []),
		...(team.models.members?.length ? [`Member models: ${team.models.members.join(", ")}`] : []),
		...(team.models.chairman ? [`Chairman model: ${team.models.chairman}`] : []),
		...(team.models.driver ? [`Driver model: ${team.models.driver}`] : []),
		...(team.models.navigator ? [`Navigator model: ${team.models.navigator}`] : []),
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

interface TeamBrowserAction {
	type: "models";
	id: string;
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
	const selectedTeam = () => detailId ? teams.find((team) => team.id === detailId) : teams[selected];
	const reload = () => {
		teams = loadTeams(ctx.cwd);
		selected = Math.min(selected, Math.max(teams.length - 1, 0));
		detailId = undefined;
		deletingId = undefined;
	};
	return ctx.ui.custom<TeamBrowserAction | undefined>((tui, theme, _kb, done) => ({
		render: (width: number) => {
			const container = new Container();
			const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));
			container.addChild(border());
			container.addChild(new Text(theme.fg("accent", theme.bold(detailId ? " Team Detail" : " Teams")), 1, 0));
			if (deletingId) {
				container.addChild(new Text(`Delete team "${deletingId}"?`, 1, 0));
				container.addChild(new Text(theme.fg("dim", " y delete · n cancel · esc close"), 1, 0));
			} else if (detailId) {
				for (const line of teamDescriptionLines(ctx.cwd, detailId)) {
					container.addChild(new Text(line, 1, 0));
				}
				container.addChild(new Text(theme.fg("dim", " m models · d delete · backspace list · esc close"), 1, 0));
			} else {
				for (const [index, team] of teams.entries()) {
					const prefix = index === selected ? "> " : "  ";
					const line = `${prefix}${team.id}: ${team.name} | ${team.topology}/${team.protocol} | ${team.source}${team.description ? ` | ${team.description}` : ""}`;
					container.addChild(new Text(index === selected ? theme.fg("accent", line) : line, 1, 0));
				}
				container.addChild(new Text(theme.fg("dim", " ↑/↓ select · enter details · m models · d delete · esc close"), 1, 0));
			}
			container.addChild(border());
			return container.render(width);
		},
		invalidate: () => undefined,
		handleInput: (data: string) => {
			if (matchesKey(data, "escape")) {
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
			if (detailId) {
				if (matchesKey(data, "backspace") || matchesKey(data, "left")) {
					detailId = undefined;
					tui.requestRender();
				}
				return;
			}
			if (matchesKey(data, "up") && selected > 0) {
				selected--;
				tui.requestRender();
				return;
			}
			if (matchesKey(data, "down") && selected < teams.length - 1) {
				selected++;
				tui.requestRender();
				return;
			}
			if (matchesKey(data, "return") || matchesKey(data, "enter")) {
				detailId = teams[selected]?.id;
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
	while (action?.type === "models") {
		await selectTeamModels(ctx, action.id);
		action = await openTeamBrowserOnce(ctx);
	}
}

export async function openTeamOverlay(
	ctx: ExtensionContext,
	title: string,
	lines: string[],
): Promise<void> {
	await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
		const container = new Container();
		const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));
		container.addChild(border());
		container.addChild(new Text(theme.fg("accent", theme.bold(` ${title}`)), 1, 0));
		for (const line of lines) {
			container.addChild(new Text(line, 1, 0));
		}
		container.addChild(new Text(theme.fg("dim", " esc close"), 1, 0));
		container.addChild(border());
		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "escape")) done();
			},
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
