/** Boost settings with Pi's native model selector as a normal selectable row. */
import { getSettingsListTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, type Component, type Focusable, SettingsList, Text } from "@earendil-works/pi-tui";
import { queueSaveBoostSetting, resolveBoostModel, resolveLeaseMinutes, resolveMaxYields } from "./boost-settings.js";
import { createBoostModelPicker } from "./model-picker.js";

export async function openBoostSettingsOverlay(ctx: ExtensionContext): Promise<void> {
	const configuredModel = await resolveBoostModel(ctx.cwd);
	const maxYields = await resolveMaxYields(ctx.cwd);
	const leaseMinutes = await resolveLeaseMinutes(ctx.cwd);
	if (ctx.mode !== "tui") {
		ctx.ui.notify(`Boost settings: model=${configuredModel ?? "auto"} maxYields=${maxYields} lease=${leaseMinutes}m`, "info");
		return;
	}

	const saves: Promise<void>[] = [];
	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new Text(theme.fg("accent", theme.bold(" Boost Settings")), 1, 0));
		let picker: ReturnType<typeof createBoostModelPicker> | undefined;
		let focused = false;
		const settingsList = new SettingsList([
			{
				id: "model",
				label: "Boost model",
				currentValue: configuredModel ?? "auto",
				description: "Enter to choose with Pi's /model selector. Changes only the boost model.",
				submenu: (current, close) => {
					picker = createBoostModelPicker(ctx, tui, current, (value) => {
						picker = undefined;
						close(value);
						tui.requestRender();
					});
					picker.focused = focused;
					return picker;
				},
			},
			{
				id: "maxYields",
				label: "Max Yields",
				currentValue: String(maxYields),
				values: ["1", "2", "3"],
				description: "Maximum boost turns per lease (hard cap 3). Expired leases renew on /boost.",
			},
			{
				id: "leaseMinutes",
				label: "Lease time (minutes)",
				currentValue: String(leaseMinutes),
				values: ["5", "10", "15", "30", "60"],
				description: "Measured from the first boost turn; applies to the current lease too. Never interrupts a running turn.",
			},
		], 8, getSettingsListTheme(), (id, value) => {
			if (id === "model" || id === "maxYields" || id === "leaseMinutes") {
				saves.push(queueSaveBoostSetting(id, id === "model" ? value : Number(value)));
			}
			tui.requestRender();
		}, () => done(undefined));
		container.addChild(settingsList);
		const component: Component & Focusable & { dispose(): void } = {
			get focused() { return focused; },
			set focused(value: boolean) {
				focused = value;
				if (picker) picker.focused = value;
			},
			render: (width) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				settingsList.handleInput(data);
				tui.requestRender();
			},
			dispose: () => picker?.dispose(),
		};
		return component;
	});
	await Promise.all(saves);
}
