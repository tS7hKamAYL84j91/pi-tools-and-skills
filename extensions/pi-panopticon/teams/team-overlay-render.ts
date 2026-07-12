/** Pure, width-bounded render helpers for the team browser overlays. */

import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, type Component, fuzzyFilter, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { formatHiddenCountCue } from "../../../lib/tui-overflow.js";
import { STATUS_SYMBOLS } from "./status-symbols.js";
import type { TeamSpec } from "./team-types.js";

const MAX_READ_ONLY_DETAIL_LINES = 15;

function readOnlyDetailLines(lines: readonly string[]): string[] {
	if (lines.length <= MAX_READ_ONLY_DETAIL_LINES) return [...lines];
	const visibleCount = MAX_READ_ONLY_DETAIL_LINES - 1;
	const hiddenCue = formatHiddenCountCue(lines.length - visibleCount, "line");
	return [...lines.slice(0, visibleCount), ...(hiddenCue ? [hiddenCue] : [])];
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
	const border = () => new DynamicBorder((text: string) => args.theme.fg("accent", text));
	container.addChild(border());
	container.addChild(new Text(args.theme.fg("accent", args.theme.bold(args.detailLines ? " Team Detail" : " Teams")), 1, 0));
	if (args.deletingId) {
		container.addChild(new Text(`Delete team "${args.deletingId}"?`, 1, 0));
		container.addChild(new Text(args.theme.fg("dim", " [y] confirm · [esc/n] cancel"), 1, 0));
	} else if (args.detailLines) {
		for (const line of readOnlyDetailLines(args.detailLines)) container.addChild(new Text(line, 1, 0));
		container.addChild(new Text(args.theme.fg("dim", " r run · f form · m models · d delete · backspace/← list · esc close"), 1, 0));
	} else {
		const visible = args.searchActive && args.query
			? fuzzyFilter(args.teams, args.query.trim(), (team) =>
				`${team.id} ${team.name} ${team.protocol} ${team.source} ${team.description ?? ""}`)
			: args.teams;
		const selected = Math.min(args.selected, Math.max(visible.length - 1, 0));
		if (args.searchActive && args.searchInput) container.addChild(args.searchInput);
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
		container.addChild(new Text(args.theme.fg("dim", args.searchActive
			? " type to filter · ↑/↓ navigate · enter detail · esc clear"
			: " ↑/↓ navigate · enter detail · r run · f form · m models · d delete · / filter · esc close"), 1, 0));
	}
	container.addChild(border());
	return container.render(args.width);
}

export function renderTeamOverlay(title: string, lines: string[], theme: Theme, width: number): string[] {
	const container = new Container();
	const border = () => new DynamicBorder((text: string) => theme.fg("accent", text));
	container.addChild(border());
	container.addChild(new Text(theme.fg("accent", theme.bold(` ${title}`)), 1, 0));
	for (const line of readOnlyDetailLines(lines)) container.addChild(new Text(line, 1, 0));
	container.addChild(new Text(theme.fg("dim", " esc close"), 1, 0));
	container.addChild(border());
	return container.render(width);
}
