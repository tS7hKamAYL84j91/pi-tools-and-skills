/** Host-registry-backed boost panel model selection: pure toggle logic and the settings submenu (ADR-056). */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	type SettingItem,
	SettingsList,
	Text,
} from "@earendil-works/pi-tui";
import { HARD_MAX_PANEL_MODELS } from "./cognitive-types.js";

/** Display value for an empty model selection: plan from the host registry. */
export const AUTO_MODEL_SELECTION_LABEL = "auto (host registry)";

/** Host registry's text-capable model IDs in registry order (ADR-056). */
export function listTextCapableModels(
	ctx: ExtensionContext,
): readonly string[] {
	const available = ctx.modelRegistry.getAvailable();
	return available
		.filter((model) => model.input.includes("text"))
		.map((model) => `${model.provider}/${model.id}`);
}

/** Toggle one model in an ordered selection, enforcing the hard panel cap. */
export function toggleModelSelection(
	selected: readonly string[],
	modelId: string,
	maxModels: number = HARD_MAX_PANEL_MODELS,
): readonly string[] {
	if (selected.includes(modelId)) {
		return selected.filter((model) => model !== modelId);
	}
	if (selected.length >= maxModels) {
		return selected;
	}
	return [...selected, modelId];
}

/** Human-readable overlay value for a model selection. */
export function formatModelSelection(selected: readonly string[]): string {
	return selected.length === 0
		? AUTO_MODEL_SELECTION_LABEL
		: `${selected.length} selected: ${selected.join(", ")}`;
}

interface ModelSelectionSubmenuCallbacks {
	readonly onToggle: (modelId: string) => void;
	readonly onClear: () => void;
	readonly onCancel: () => void;
}

/** Multi-select submenu over the host registry's text-capable models. */
export class ModelSelectionSubmenu extends Container {
	private readonly settingsList: SettingsList;

	constructor(
		title: string,
		availableModels: readonly string[],
		selected: readonly string[],
		callbacks: ModelSelectionSubmenuCallbacks,
	) {
		super();
		const selectedSet = new Set(selected);
		const items: SettingItem[] = [
			{
				id: "clear",
				label: "Clear selection",
				description: `Use the host model registry automatically (max ${HARD_MAX_PANEL_MODELS} selectable).`,
				currentValue: AUTO_MODEL_SELECTION_LABEL,
				values: [AUTO_MODEL_SELECTION_LABEL],
			},
			...availableModels.map((modelId) => ({
				id: modelId,
				label: modelId,
				currentValue: selectedSet.has(modelId) ? "selected" : "off",
				values: ["selected", "off"],
				description: `Toggle this model into the boost panel (max ${HARD_MAX_PANEL_MODELS}).`,
			})),
		];
		this.addChild(new Text(title, 1, 0));
		this.settingsList = new SettingsList(
			items,
			Math.min(items.length + 2, 12),
			getSettingsListTheme(),
			(id) => {
				if (id === "clear") {
					callbacks.onClear();
				} else {
					callbacks.onToggle(id);
				}
			},
			callbacks.onCancel,
		);
		this.addChild(this.settingsList);
	}

	handleInput(data: string): void {
		this.settingsList.handleInput(data);
	}
}
