/**
 * Interactive model binding selection for teams.
 */

import { DynamicBorder, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	Container,
	fuzzyFilter,
	Input,
	SelectList,
	type SelectItem,
	Text,
} from "@mariozechner/pi-tui";
import { providerOf, snapshotAvailableModels } from "./members.js";
import { type TeamFormModels, updateTeamModels } from "./team-form.js";
import { modelSlotsForTeam, type TeamModelSlot } from "./team-handlers.js";
import { loadTeamRegistry } from "./team-registry.js";
import type { TeamSpec } from "./team-types.js";

interface MutableSelectListInternals {
	items: SelectItem[];
	filteredItems: SelectItem[];
	selectedIndex: number;
}

class FuzzySelectList extends SelectList {
	private readonly allItems: SelectItem[];

	constructor(
		items: SelectItem[],
		maxVisible: number,
		theme: ConstructorParameters<typeof SelectList>[2],
		layout?: ConstructorParameters<typeof SelectList>[3],
	) {
		super(items, maxVisible, theme, layout);
		this.allItems = items;
	}

	override setFilter(query: string): void {
		const internals = this as unknown as MutableSelectListInternals;
		const trimmed = query.trim();
		internals.filteredItems = trimmed.length === 0
			? this.allItems
			: fuzzyFilter(
					this.allItems,
					trimmed,
					(item) => `${item.label} ${item.description ?? ""} ${item.value}`,
				);
		internals.selectedIndex = 0;
	}
}

interface PickerOptions {
	selected?: string[];
}

async function pickOption(
	ctx: ExtensionContext,
	title: string,
	items: SelectItem[],
	options: PickerOptions = {},
): Promise<string | undefined> {
	if (items.length === 0) {
		ctx.ui.notify(`No options available for ${title}.`, "warning");
		return undefined;
	}
	return ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
		const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));
		const container = new Container();
		container.addChild(border());
		container.addChild(
			new Text(
				theme.fg("accent", theme.bold(` ${title}`)) +
					theme.fg("dim", ` — ${items.length} option${items.length !== 1 ? "s" : ""}`),
				1,
				0,
			),
		);
		if (options.selected && options.selected.length > 0) {
			container.addChild(
				new Text(theme.fg("muted", `  Selected: ${options.selected.join(", ")}`), 1, 0),
			);
		}
		container.addChild(
			new Text(
				theme.fg("dim", "  Type to search • ↑↓ navigate • enter select • esc exit"),
				1,
				0,
			),
		);
		const search = new Input();
		search.focused = true;
		container.addChild(search);
		const longestLabel = items.reduce((max, item) => Math.max(max, item.label.length), 0);
		const selectList = new FuzzySelectList(
			items,
			Math.min(items.length, 15),
			{
				selectedPrefix: (text: string) => theme.fg("accent", text),
				selectedText: (text: string) => theme.fg("accent", text),
				description: (text: string) => theme.fg("muted", text),
				scrollInfo: (text: string) => theme.fg("dim", text),
				noMatch: (text: string) => theme.fg("warning", text),
			},
			{
				minPrimaryColumnWidth: Math.min(longestLabel + 2, 80),
				maxPrimaryColumnWidth: 200,
			},
		);
		selectList.onSelect = (item) => done(item.value);
		selectList.onCancel = () => done(undefined);
		container.addChild(selectList);
		container.addChild(border());

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				const isSelectKey =
					keybindings.matches(data, "tui.select.up") ||
					keybindings.matches(data, "tui.select.down") ||
					keybindings.matches(data, "tui.select.confirm") ||
					keybindings.matches(data, "tui.select.cancel");
				if (isSelectKey) {
					selectList.handleInput(data);
				} else {
					search.handleInput(data);
					selectList.setFilter(search.getValue());
				}
				tui.requestRender();
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

function modelItems(models: string[]): SelectItem[] {
	return models.map((model) => ({
		value: model,
		label: model,
		description: providerOf(model),
	}));
}

async function pickModel(
	ctx: ExtensionContext,
	title: string,
	models: string[],
	current?: string,
): Promise<string | undefined> {
	const allModels = [...new Set([...(current ? [current] : []), ...models])];
	return pickOption(ctx, title, modelItems(allModels), {
		...(current ? { selected: [current] } : {}),
	});
}

function copyModels(models: TeamFormModels): TeamFormModels {
	return {
		...(models.members ? { members: [...models.members] } : {}),
		...(models.chairman ? { chairman: models.chairman } : {}),
		...(models.driver ? { driver: models.driver } : {}),
		...(models.navigator ? { navigator: models.navigator } : {}),
	};
}

async function pickTeamForModels(ctx: ExtensionContext, requested?: string): Promise<string | undefined> {
	if (requested) return requested;
	const teams = [...loadTeamRegistry(undefined, { cwd: ctx.cwd }).teams.values()]
		.sort((a, b) => a.id.localeCompare(b.id));
	const items = teams.map((team) => ({
		value: team.id,
		label: team.id,
		description: `${team.name} • ${team.topology}/${team.protocol} • ${team.source}`,
	}));
	return pickOption(ctx, "Select team", items);
}

async function pickModelSlot(
	ctx: ExtensionContext,
	team: TeamSpec,
	models: TeamFormModels,
): Promise<TeamModelSlot | undefined> {
	const slots = modelSlotsForTeam(team, models);
	const picked = await pickOption(
		ctx,
		`Select model binding for ${team.id}`,
		slots.map((slot, index) => ({
			value: slot.id,
			label: `${index + 1}. ${slot.label}`,
			description: slot.current ?? "(unset)",
		})),
	);
	return slots.find((slot) => slot.id === picked);
}

function applyModelSlot(
	models: TeamFormModels,
	slot: TeamModelSlot,
	model: string,
): TeamFormModels {
	const next = copyModels(models);
	if (slot.kind === "member") {
		const members = [...(next.members ?? [])];
		members[slot.index ?? 0] = model;
		next.members = members;
	} else if (slot.kind === "chairman") {
		next.chairman = model;
	} else if (slot.kind === "driver") {
		next.driver = model;
	} else {
		next.navigator = model;
	}
	return next;
}

export async function selectTeamModels(
	ctx: ExtensionContext,
	requested?: string,
): Promise<string | undefined> {
	const id = await pickTeamForModels(ctx, requested);
	if (!id) return undefined;
	const team = loadTeamRegistry(undefined, { cwd: ctx.cwd }).teams.get(id);
	if (!team) throw new Error(`No team "${id}".`);
	const available = snapshotAvailableModels(ctx);
	let models = copyModels(team.models);
	let changed = false;
	while (true) {
		const slot = await pickModelSlot(ctx, team, models);
		if (!slot) return changed ? id : undefined;
		const model = await pickModel(ctx, slot.label, available, slot.current);
		if (!model) return changed ? id : undefined;
		models = applyModelSlot(models, slot, model);
		const result = updateTeamModels({ id, models }, ctx.cwd);
		changed = true;
		ctx.ui.notify(`Updated ${slot.label.toLowerCase()} for "${result.id}"`, "info");
	}
}
