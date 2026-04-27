/**
 * Model picker overlay — Input + fuzzy-filtered SelectList for type-to-find
 * council member / chairman selection.
 *
 * Substring/fuzzy filter via pi-tui's fuzzyFilter (typing "gpt" matches
 * "openai-codex/gpt-5.5"). The Input captures printable characters and
 * pushes them into FuzzySelectList.setFilter on each keystroke.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
	Container,
	fuzzyFilter,
	getKeybindings,
	Input,
	SelectList,
	type SelectItem,
	Text,
} from "@mariozechner/pi-tui";
import { COUNCIL_MIN } from "./members.js";

interface MutableSelectListInternals {
	items: SelectItem[];
	filteredItems: SelectItem[];
	selectedIndex: number;
}

/**
 * Subclass that swaps the prefix-startsWith default for substring/fuzzy
 * matching against label + description + value. Required because pi-tui's
 * SelectList.setFilter is hard-coded to startsWith on value, which makes
 * model ids like "openai-codex/gpt-5.5" un-findable by typing "gpt".
 */
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

interface PickModelOptions {
	selected?: string[];
	describe?: (value: string) => string;
}

/**
 * Open a model picker overlay. Returns the selected value or undefined if
 * cancelled. `describe(value)` customises the right-hand description per
 * entry — e.g. "live • <model>" for agent refs.
 */
export async function pickModel(
	ctx: ExtensionContext,
	title: string,
	models: string[],
	options: PickModelOptions = {},
): Promise<string | undefined> {
	const selected = options.selected ?? [];
	const describe = options.describe;
	const items: SelectItem[] = models.map((m) => ({
		value: m,
		label: m,
		description: describe ? describe(m) : (m.split("/")[0] || "unknown"),
	}));

	return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
		const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));
		const container = new Container();
		container.addChild(border());
		container.addChild(
			new Text(
				theme.fg("accent", theme.bold(` ${title}`)) +
					theme.fg("dim", ` — ${models.length} option${models.length !== 1 ? "s" : ""}`),
				1,
				0,
			),
		);
		if (selected.length > 0) {
			container.addChild(
				new Text(theme.fg("muted", `  Selected: ${selected.join(", ")}`), 1, 0),
			);
		}
		container.addChild(
			new Text(
				theme.fg("dim", "  Type to search • ↑↓ navigate • enter select • esc cancel"),
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
				selectedPrefix: (t: string) => theme.fg("accent", t),
				selectedText: (t: string) => theme.fg("accent", t),
				description: (t: string) => theme.fg("muted", t),
				scrollInfo: (t: string) => theme.fg("dim", t),
				noMatch: (t: string) => theme.fg("warning", t),
			},
			{
				// Reserve enough width to render the longest model id without truncation.
				// Cap at 200 so we don't blow up narrow terminals on absurd label lengths.
				minPrimaryColumnWidth: Math.min(longestLabel + 2, 80),
				maxPrimaryColumnWidth: 200,
			},
		);
		selectList.onSelect = (item) => done(item.value);
		selectList.onCancel = () => done(undefined);
		container.addChild(selectList);
		container.addChild(border());

		return {
			render: (w: number) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				const kb = getKeybindings();
				const isNav =
					kb.matches(data, "tui.select.up") ||
					kb.matches(data, "tui.select.down") ||
					kb.matches(data, "tui.select.confirm") ||
					kb.matches(data, "tui.select.cancel");
				if (isNav) {
					selectList.handleInput(data);
				} else {
					search.handleInput(data);
					selectList.setFilter(search.getValue());
				}
				tui.requestRender();
			},
		};
	});
}

/**
 * Pick exactly `count` council members from `modelOptions`. Returns undefined
 * if the user cancels before reaching the target count or if fewer than
 * `count` distinct options are available.
 */
export async function pickCouncilMembers(
	ctx: ExtensionContext,
	modelOptions: string[],
	count: number,
	describe?: (value: string) => string,
): Promise<string[] | undefined> {
	if (modelOptions.length < count) {
		ctx.ui.notify(
			`Only ${modelOptions.length} distinct option(s) available; need ${count}.`,
			"warning",
		);
		return undefined;
	}
	const members: string[] = [];
	while (members.length < count) {
		const remaining = modelOptions.filter((model) => !members.includes(model));
		const title = `Add member ${members.length + 1}/${count}`;
		const choice = await pickModel(ctx, title, remaining, { selected: members, describe });
		if (!choice) {
			if (members.length >= COUNCIL_MIN - 1) {
				return undefined;
			}
			ctx.ui.notify(
				`Council needs ${count} member(s); selection cancelled.`,
				"warning",
			);
			return undefined;
		}
		members.push(choice);
	}
	return members;
}
