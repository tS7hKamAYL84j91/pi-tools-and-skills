/**
 * Model picker overlay — fuzzy-search TUI for selecting council members.
 *
 * Uses ctx.ui.custom() with SelectList from pi-tui for type-to-filter
 * selection instead of scrolling through a flat alphabetized list.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, SelectList, type SelectItem, Text } from "@mariozechner/pi-tui";
import { COUNCIL_MAX, COUNCIL_MIN } from "./members.js";

/**
 * Open a fuzzy-search model picker overlay.
 * Returns the selected model ID, or undefined if cancelled.
 */
export async function pickModel(
	ctx: ExtensionContext,
	title: string,
	models: string[],
	selected: string[] = [],
): Promise<string | undefined> {
	const items: SelectItem[] = models.map((m) => {
		const provider = m.split("/")[0];
		return {
			value: m,
			label: m,
			description: provider,
		};
	});

	return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
		const border = () =>
			new DynamicBorder((s: string) => theme.fg("accent", s));
		const container = new Container();
		container.addChild(border());
		container.addChild(
			new Text(
				theme.fg("accent", theme.bold(` ${title}`))
					+ theme.fg(
						"dim",
						` — ${models.length} model${models.length !== 1 ? "s" : ""}`,
					),
				1,
				0,
			),
		);
		if (selected.length > 0) {
			container.addChild(
				new Text(
					theme.fg("muted", `  Selected: ${selected.join(", ")}`),
					1,
					0,
				),
			);
		}
		container.addChild(
			new Text(
				theme.fg(
					"dim",
					"  Type to search • ↑↓ navigate • enter select • esc cancel",
				),
				1,
				0,
			),
		);
		const selectList = new SelectList(
			items,
			Math.min(items.length, 15),
			{
				selectedPrefix: (t: string) => theme.fg("accent", t),
				selectedText: (t: string) => theme.fg("accent", t),
				description: (t: string) => theme.fg("muted", t),
				scrollInfo: (t: string) => theme.fg("dim", t),
				noMatch: (t: string) => theme.fg("warning", t),
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
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

/** Pick a valid council member set with fuzzy-search model selection. */
export async function pickCouncilMembers(
	ctx: ExtensionContext,
	modelOptions: string[],
): Promise<string[] | undefined> {
	const members: string[] = [];
	while (members.length < COUNCIL_MAX) {
		const remaining = modelOptions.filter((model) => !members.includes(model));
		if (remaining.length === 0) {
			if (members.length >= COUNCIL_MIN) break;
			ctx.ui.notify(
				`Only ${members.length} distinct model(s) available; council needs at least ${COUNCIL_MIN}.`,
				"warning",
			);
			return undefined;
		}
		const title = members.length === 0
			? "Add council member"
			: `Add member ${members.length + 1}/${COUNCIL_MAX} (Esc to finish)`;
		const choice = await pickModel(ctx, title, remaining, members);
		if (!choice) {
			if (members.length >= COUNCIL_MIN) break;
			ctx.ui.notify(
				`Council needs at least ${COUNCIL_MIN} members.`,
				"warning",
			);
			return undefined;
		}
		members.push(choice);
	}
	return members.length >= COUNCIL_MIN ? members : undefined;
}
