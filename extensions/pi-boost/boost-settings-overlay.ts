/** TUI overlay for boost settings: model picker and max yields. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import {
	Container,
	SettingsList,
	Text,
} from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { resolveBoostModel, resolveMaxYields } from "./boost-settings.js";

function piSettingsPath(): string {
	return join(homedir(), ".pi", "agent", "settings.json");
}

async function saveBoostSetting(
	key: "model" | "maxYields",
	value: string | number,
): Promise<void> {
	const path = piSettingsPath();
	let settings: Record<string, unknown> = {};
	try {
		settings = JSON.parse(await readFile(path, "utf8")) as Record<
			string,
			unknown
		>;
	} catch {
		// Fresh settings file.
	}
	const boost = typeof settings.boost === "object" && settings.boost !== null
		? (settings.boost as Record<string, unknown>)
		: {};
	boost[key] = value;
	settings.boost = boost;
	await writeFileAtomic(path, JSON.stringify(settings, null, 2) + "\n", {
		mode: 0o600,
	});
}

/** Open the boost settings overlay. */
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

	let selectedModel = configuredModel ?? "auto";
	let selectedMaxYields = String(maxYields);

	const availableModels = ctx.modelRegistry
		.getAvailable()
		.filter((m) => m.input.includes("text"))
		.map((m) => `${m.provider}/${m.id}`);

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(
			new Text(theme.fg("accent", theme.bold(" Boost Settings")), 1, 0),
		);
		container.addChild(
			new Text(
				theme.fg(
					"dim",
					` model=${selectedModel} · maxYields=${selectedMaxYields}`,
				),
				1,
				0,
			),
		);

		const items = [
			{
				id: "model",
				label: "Boost Model",
				currentValue: selectedModel,
				values: ["auto", ...availableModels],
				description:
					"Model to switch to during a boost lease. 'auto' picks the first text model that differs from your current model.",
			},
			{
				id: "maxYields",
				label: "Max Yields",
				currentValue: selectedMaxYields,
				values: ["1", "3", "5", "10"],
				description: "Maximum boost turns before reset is required.",
			},
		];

		const settingsList = new SettingsList(
			items,
			Math.min(items.length + 2, 8),
			getSettingsListTheme(),
			(id, newValue) => {
				if (id === "model") {
					selectedModel = newValue;
					void saveBoostSetting("model", newValue);
				} else if (id === "maxYields") {
					selectedMaxYields = newValue;
					void saveBoostSetting("maxYields", Number(newValue));
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
				settingsList.handleInput?.(data);
				tui.requestRender();
			},
		};
	});
}