/** TUI SettingsList overlay for inspecting, editing, and persisting Boost settings with inheritance/provenance display. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	type SettingItem,
	SettingsList,
	Text,
} from "@earendil-works/pi-tui";
import {
	createBoostSettingsWriter,
	resolveEffectiveBoostSettings,
} from "../boost-settings.js";
import {
	HARD_MAX_PANEL_MODELS,
	type CognitiveProfile,
} from "./cognitive-types.js";
import {
	DEFAULT_BOOST_HOST_CAPABILITIES,
	type BoostHostCapabilities,
} from "./host-capabilities.js";
import {
	AUTO_MODEL_SELECTION_LABEL,
	formatModelSelection,
	listTextCapableModels,
	ModelSelectionSubmenu,
	toggleModelSelection,
} from "./model-selection.js";

function executionSummary(
	mode: "single" | "fusion",
	panelSize: number,
): string {
	return mode === "single"
		? "1 model, no judge"
		: `${panelSize} models + judge`;
}

/** Open the interactive `/boost` settings overlay. */
export async function openBoostSettingsOverlay(
	ctx: ExtensionContext,
	hostCapabilities: BoostHostCapabilities = DEFAULT_BOOST_HOST_CAPABILITIES,
): Promise<void> {
	const isTrusted = hostCapabilities.isProjectTrusted(ctx.cwd, ctx);
	const current = resolveEffectiveBoostSettings(
		ctx.cwd,
		isTrusted,
		hostCapabilities.globalSettingsPath,
	);

	if (!ctx.hasUI) {
		const modelsLabel =
			current.models.length === 0
				? AUTO_MODEL_SELECTION_LABEL
				: current.models.join(",");
		const summary = [
			`Boost effective settings:`,
			`  mode: ${current.mode} [${current.sources.mode}]`,
			`  execution: ${executionSummary(current.mode, current.panelSize)}`,
			`  configured candidates: ${modelsLabel} [${current.sources.models}]`,
			`  profile: ${current.profile} [${current.sources.profile}]`,
			`  agentSelfBoost: ${current.agentSelfBoost.enabled ? "enabled" : "disabled"} [${current.sources.agentSelfBoost}]`,
		].join("\n");
		ctx.ui.notify(summary, "info");
		return;
	}

	const availableModels = listTextCapableModels(ctx);
	let targetScope: "project" | "global" = isTrusted ? "project" : "global";
	let selectedMode: "single" | "fusion" = current.mode;
	let selectedProfile: CognitiveProfile = current.profile;
	let selectedPanelSize = String(current.panelSize);
	let selectedModels: string[] = [...current.models];
	let selectedAgentSelfBoost = current.agentSelfBoost.enabled
		? "enabled"
		: "disabled";
	let selectedMaxYields = String(current.agentSelfBoost.maxYields);
	let selectedMaxPanelModels = String(current.agentSelfBoost.maxPanelModels);
	let selectedEnvironmental = current.agentSelfBoost.allowEnvironmental
		? "enabled"
		: "disabled";
	let selectedCognitive = current.agentSelfBoost.allowCognitive
		? "enabled"
		: "disabled";
	const writer = createBoostSettingsWriter(
		ctx.cwd,
		hostCapabilities.globalSettingsPath,
		(error) => {
			ctx.ui.notify(
				`Boost settings save failed: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		},
	);

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const container = new Container();

		container.addChild(
			new Text(theme.fg("accent", theme.bold(" Boost Configuration")), 1, 0),
		);
		container.addChild(
			new Text(
				theme.fg(
					"dim",
					` inspect inheritance · mode=${current.mode} [${current.sources.mode}] · models=${current.models.length === 0 ? AUTO_MODEL_SELECTION_LABEL : current.models.join(",")} [${current.sources.models}] · execution=${executionSummary(current.mode, current.panelSize)} · timeout=${current.timeoutMs}ms [${current.sources.timeoutMs}]`,
				),
				1,
				0,
			),
		);

		const persist = (updates: Parameters<typeof writer.enqueue>[1]): void => {
			writer.enqueue(targetScope, updates);
		};

		const items: SettingItem[] = [
			{
				id: "scope",
				label: "Save Target Scope",
				currentValue: targetScope,
				values: isTrusted ? ["project", "global"] : ["global"],
			},
			{
				id: "mode",
				label: `Mode [${current.sources.mode}]`,
				currentValue: selectedMode,
				values: ["single", "fusion"],
			},
			{
				id: "profile",
				label: `Profile [${current.sources.profile}]`,
				currentValue: selectedProfile,
				values: ["fast", "balanced", "thorough"],
			},
			{
				id: "panelSize",
				label: `Fusion Panel Size [${current.sources.panelSize}]`,
				currentValue: selectedPanelSize,
				values: ["1", "2", "3", "4"],
			},
			{
				id: "models",
				label: `Models [${current.sources.models}]`,
				currentValue: formatModelSelection(selectedModels),
				description: `Panel models from the host model registry (text-capable). Empty selection = ${AUTO_MODEL_SELECTION_LABEL}; up to ${HARD_MAX_PANEL_MODELS} selectable.`,
				submenu: (_currentValue, doneModels) =>
					new ModelSelectionSubmenu(
						theme.fg("accent", theme.bold(" Boost Panel Models")),
						availableModels,
						selectedModels,
						{
							onToggle: (modelId) => {
								selectedModels = [
									...toggleModelSelection(selectedModels, modelId),
								];
								persist({ models: selectedModels });
							},
							onClear: () => {
								selectedModels = [];
								persist({ models: selectedModels });
							},
							onCancel: () => {
								doneModels();
							},
						},
					),
			},
			{
				id: "agentSelfBoost",
				label: `Agent Self-Boost [${current.sources.agentSelfBoost}]`,
				currentValue: selectedAgentSelfBoost,
				values: ["disabled", "enabled"],
			},
			{
				id: "maxYields",
				label: "Agent Max Yields",
				currentValue: selectedMaxYields,
				values: ["1", "2", "3"],
			},
			{
				id: "maxPanelModels",
				label: "Agent Max Panel",
				currentValue: selectedMaxPanelModels,
				values: ["1", "2", "3", "4"],
			},
			{
				id: "allowEnvironmental",
				label: "Agent Environmental",
				currentValue: selectedEnvironmental,
				values: ["disabled", "enabled"],
			},
			{
				id: "allowCognitive",
				label: "Agent Cognitive",
				currentValue: selectedCognitive,
				values: ["disabled", "enabled"],
			},
		];

		const settingsList = new SettingsList(
			items,
			Math.min(items.length + 2, 10),
			getSettingsListTheme(),
			(id, newValue) => {
				if (id === "scope") {
					if (newValue === "project" || newValue === "global") {
						targetScope = newValue;
					}
				} else if (id === "mode") {
					if (newValue !== "single" && newValue !== "fusion") {
						return;
					}
					selectedMode = newValue;
					persist({ mode: selectedMode });
				} else if (id === "profile") {
					if (
						newValue !== "fast" &&
						newValue !== "balanced" &&
						newValue !== "thorough"
					) {
						return;
					}
					selectedProfile = newValue;
					persist({ profile: selectedProfile });
				} else if (id === "panelSize") {
					selectedPanelSize = newValue;
					persist({ panelSize: Number(selectedPanelSize) });
				} else if (id === "agentSelfBoost") {
					selectedAgentSelfBoost = newValue;
					persist({
						agentSelfBoost: { enabled: selectedAgentSelfBoost === "enabled" },
					});
				} else if (id === "maxYields") {
					selectedMaxYields = newValue;
					persist({ agentSelfBoost: { maxYields: Number(newValue) } });
				} else if (id === "maxPanelModels") {
					selectedMaxPanelModels = newValue;
					persist({ agentSelfBoost: { maxPanelModels: Number(newValue) } });
				} else if (id === "allowEnvironmental") {
					selectedEnvironmental = newValue;
					persist({
						agentSelfBoost: { allowEnvironmental: newValue === "enabled" },
					});
				} else if (id === "allowCognitive") {
					selectedCognitive = newValue;
					persist({
						agentSelfBoost: { allowCognitive: newValue === "enabled" },
					});
				}
				tui.requestRender();
			},
			() => {
				void writer.drain().then(() => {
					done(undefined);
				});
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
