/**
 * Model picker overlay — Input + filtered SelectList for type-to-filter
 * council member / chairman selection.
 *
 * Filtering is prefix-match on the SelectItem value (pi-tui's SelectList
 * semantics). Typing "openai" narrows to openai models; "agent:" narrows
 * to live agents; "agent:b" narrows further. The Input widget captures
 * printable characters and pipes them into setFilter on each keystroke.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
	Container,
	getKeybindings,
	Input,
	SelectList,
	type SelectItem,
	Text,
} from "@mariozechner/pi-tui";
import { COUNCIL_MIN } from "./members.js";

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
		const selectList = new SelectList(items, Math.min(items.length, 15), {
			selectedPrefix: (t: string) => theme.fg("accent", t),
			selectedText: (t: string) => theme.fg("accent", t),
			description: (t: string) => theme.fg("muted", t),
			scrollInfo: (t: string) => theme.fg("dim", t),
			noMatch: (t: string) => theme.fg("warning", t),
		});
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
