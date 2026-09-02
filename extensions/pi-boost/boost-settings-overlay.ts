/** TUI overlay for boost settings: model picker launch and max yields. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, Text } from "@earendil-works/pi-tui";
import {
	queueSaveBoostSetting,
	resolveBoostModel,
	resolveMaxYields,
} from "./boost-settings.js";
import { openModelPicker } from "./model-picker.js";

/** Open the boost settings overlay: [m] launches the native-style model picker. */
export async function openBoostSettingsOverlay(
	ctx: ExtensionContext,
): Promise<void> {
	const configuredModel = await resolveBoostModel(ctx.cwd);
	const maxYields = await resolveMaxYields(ctx.cwd);
	if (!ctx.hasUI) {
		ctx.ui.notify(
			`Boost settings: model=${configuredModel ?? "auto"} maxYields=${maxYields}`,
			"info",
		);
		return;
	}

	let selectedMaxYields = String(maxYields);

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(
			new Text(theme.fg("accent", theme.bold(" Boost Settings")), 1, 0),
		);
		container.addChild(
			new Text(
				theme.fg(
					"dim",
					` model=${configuredModel ?? "auto"} · maxYields=${selectedMaxYields} · [m] pick model`,
				),
				1,
				0,
			),
		);

		const items = [
			{
				id: "maxYields",
				label: "Max Yields",
				currentValue: selectedMaxYields,
				values: ["1", "2", "3"],
				description:
					"Maximum boost turns before reset is required (hard cap 3, ADR-045).",
			},
		];

		const settingsList = new SettingsList(
			items,
			Math.min(items.length + 2, 8),
			getSettingsListTheme(),
			(id, newValue) => {
				if (id === "maxYields") {
					selectedMaxYields = newValue;
					void queueSaveBoostSetting("maxYields", Number(newValue));
				}
				tui.requestRender();
			},
			() => {
				done(undefined);
			},
		);

		container.addChild(settingsList);
		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (data === "m" || data === "M") {
					void openModelPicker(ctx).then(() => tui.requestRender());
					return;
				}
				settingsList.handleInput?.(data);
				tui.requestRender();
			},
		};
	});
}