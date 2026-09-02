/** Native-style searchable model picker for boost (ADR-057 UX contract). */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, Text } from "@earendil-works/pi-tui";
import {
	queueSaveBoostSetting,
	resolveBoostModel,
	resolveMaxYields,
} from "./boost-settings.js";

function modelKey(model: { provider: string; id: string }): string {
	return `${model.provider}/${model.id}`;
}

/** Open a type-to-filter model picker; saves the selection to boost settings. */
export async function openModelPicker(ctx: ExtensionContext): Promise<void> {
	const configuredModel = await resolveBoostModel(ctx.cwd);
	const maxYields = await resolveMaxYields(ctx.cwd);
	if (!ctx.hasUI) {
		ctx.ui.notify(
			`Boost model: ${configuredModel ?? "auto"} · maxYields=${maxYields}`,
			"info",
		);
		return;
	}

	const baselineId = ctx.model ? modelKey(ctx.model) : "";
	const options = ctx.modelRegistry
		.getAvailable()
		.filter((m) => m.input.includes("text"))
		.map(modelKey);

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		let filter = "";
		let selected = 0;

		const container = new Container();
		container.addChild(
			new Text(theme.fg("accent", theme.bold(" Boost Model")), 1, 0),
		);
		const filterText = new Text("", 1, 0);
		const listText = new Text("", 1, 0);
		container.addChild(filterText);
		container.addChild(listText);
		container.addChild(
			new Text(
				theme.fg("dim", " type to filter · ↑/↓ select · enter save · esc cancel"),
				1,
				0,
			),
		);

		const visible = (): string[] =>
			options.filter((id) => id.toLowerCase().includes(filter.toLowerCase()));

		const renderList = (): void => {
			const items = visible();
			if (selected >= items.length) selected = Math.max(0, items.length - 1);
			const start = Math.max(0, Math.min(selected - 6, Math.max(0, items.length - 10)));
			const lines = items
				.slice(start, start + 10)
				.map((id, offset) => {
					const index = start + offset;
					const cursor = index === selected ? "▸ " : "  ";
					const marker = id === configuredModel ? "● " : "  ";
					const suffix = id === baselineId ? theme.fg("dim", " (baseline)") : "";
					return `${cursor}${marker}${id}${suffix}`;
				});
			if (lines.length === 0) {
				lines.push(theme.fg("dim", " no matching models"));
			}
			listText.setText(lines.join("\n"));
			filterText.setText(` search: ${filter}`);
		};
		renderList();

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "escape")) {
					done(undefined);
					return;
				}
				if (matchesKey(data, "return")) {
					const choice = visible()[selected];
					if (choice) {
						void queueSaveBoostSetting("model", choice);
					}
					done(undefined);
					return;
				}
				if (matchesKey(data, "up")) {
					selected = Math.max(0, selected - 1);
				} else if (matchesKey(data, "down")) {
					selected = Math.min(Math.max(0, visible().length - 1), selected + 1);
				} else if (matchesKey(data, "backspace")) {
					filter = filter.slice(0, -1);
				} else if (data.length === 1 && data >= " ") {
					filter += data;
				}
				renderList();
				tui.requestRender();
			},
		};
	});
}