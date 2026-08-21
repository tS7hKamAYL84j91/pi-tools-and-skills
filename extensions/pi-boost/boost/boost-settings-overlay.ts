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
import type { CognitiveProfile } from "./cognitive-types.js";
import {
	DEFAULT_BOOST_HOST_CAPABILITIES,
	type BoostHostCapabilities,
} from "./host-capabilities.js";

/** Open the interactive `/boost` settings overlay. */
export async function openBoostSettingsOverlay(
	ctx: ExtensionContext,
	hostCapabilities: BoostHostCapabilities = DEFAULT_BOOST_HOST_CAPABILITIES,
): Promise<void> {
	const isTrusted = hostCapabilities.isProjectTrusted(ctx.cwd, ctx);
	const current = resolveEffectiveBoostSettings(ctx.cwd, isTrusted, hostCapabilities.globalSettingsPath);

	if (!ctx.hasUI) {
		const summary = [
			`Boost effective settings:`,
			`  profile: ${current.profile} [${current.sources.profile}]`,
			`  panelSize: ${current.panelSize} [${current.sources.panelSize}]`,
			`  agentSelfBoost: ${current.agentSelfBoost.enabled ? "enabled" : "disabled"} [${current.sources.agentSelfBoost}]`,
		].join("\n");
		ctx.ui.notify(summary, "info");
		return;
	}

	let targetScope: "project" | "global" = isTrusted ? "project" : "global";
	let selectedProfile: CognitiveProfile = current.profile;
	let selectedPanelSize = String(current.panelSize);
	let selectedAgentSelfBoost = current.agentSelfBoost.enabled ? "enabled" : "disabled";
	let selectedMaxYields = String(current.agentSelfBoost.maxYields);
	let selectedMaxPanelModels = String(current.agentSelfBoost.maxPanelModels);
	let selectedEnvironmental = current.agentSelfBoost.allowEnvironmental ? "enabled" : "disabled";
	let selectedCognitive = current.agentSelfBoost.allowCognitive ? "enabled" : "disabled";
	const writer = createBoostSettingsWriter(ctx.cwd, hostCapabilities.globalSettingsPath, (error) => {
		ctx.ui.notify(`Boost settings save failed: ${error instanceof Error ? error.message : String(error)}`, "error");
	});

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const container = new Container();

		container.addChild(
			new Text(
				theme.fg("accent", theme.bold(" Boost Configuration")),
				1,
				0,
			),
		);
		container.addChild(
			new Text(
				theme.fg(
					"dim",
					` inspect inheritance · fixed models=${current.models.join(",")} [${current.sources.models}] · judge=${current.judge ?? "panel[0]"} [${current.sources.judge}] · timeout=${current.timeoutMs}ms [${current.sources.timeoutMs}]`,
				),
				1,
				0,
			),
		);

		const items: SettingItem[] = [
			{
				id: "scope",
				label: "Save Target Scope",
				currentValue: targetScope,
				values: isTrusted ? ["project", "global"] : ["global"],
			},
			{
				id: "profile",
				label: `Profile [${current.sources.profile}]`,
				currentValue: selectedProfile,
				values: ["fast", "balanced", "thorough"],
			},
			{
				id: "panelSize",
				label: `Panel Size [${current.sources.panelSize}]`,
				currentValue: selectedPanelSize,
				values: ["1", "2", "3", "4"],
			},
			{
				id: "agentSelfBoost",
				label: `Agent Self-Boost [${current.sources.agentSelfBoost}]`,
				currentValue: selectedAgentSelfBoost,
				values: ["disabled", "enabled"],
			},
			{ id: "maxYields", label: "Agent Max Yields", currentValue: selectedMaxYields, values: ["1", "2", "3"] },
			{ id: "maxPanelModels", label: "Agent Max Panel", currentValue: selectedMaxPanelModels, values: ["1", "2", "3", "4"] },
			{ id: "allowEnvironmental", label: "Agent Environmental", currentValue: selectedEnvironmental, values: ["disabled", "enabled"] },
			{ id: "allowCognitive", label: "Agent Cognitive", currentValue: selectedCognitive, values: ["disabled", "enabled"] },
		];

		const persist = (updates: Parameters<typeof writer.enqueue>[1]): void => {
			writer.enqueue(targetScope, updates);
		};

		const settingsList = new SettingsList(
			items,
			Math.min(items.length + 2, 10),
			getSettingsListTheme(),
			(id, newValue) => {
				if (id === "scope") {
					if (newValue === "project" || newValue === "global") {
						targetScope = newValue;
					}
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
					persist({ agentSelfBoost: { enabled: selectedAgentSelfBoost === "enabled" } });
				} else if (id === "maxYields") {
					selectedMaxYields = newValue;
					persist({ agentSelfBoost: { maxYields: Number(newValue) } });
				} else if (id === "maxPanelModels") {
					selectedMaxPanelModels = newValue;
					persist({ agentSelfBoost: { maxPanelModels: Number(newValue) } });
				} else if (id === "allowEnvironmental") {
					selectedEnvironmental = newValue;
					persist({ agentSelfBoost: { allowEnvironmental: newValue === "enabled" } });
				} else if (id === "allowCognitive") {
					selectedCognitive = newValue;
					persist({ agentSelfBoost: { allowCognitive: newValue === "enabled" } });
				}
				tui.requestRender();
			},
			() => {
				void writer.drain().then(() => { done(undefined); });
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
