/** Boost settings resolution and locked persistence through standard Pi settings files. */

import { join } from "node:path";
import { withAdvisoryLock } from "../../lib/file-lock.js";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { PI_SETTINGS_PATH } from "../../lib/pi-settings.js";
import { DEFAULT_PANEL_MODELS } from "./boost/cognitive-types.js";
import {
	applySettings,
	DEFAULT_TIMEOUT_MS,
	type BoostSettings,
	isRecord,
	readBoostSettings,
	type ResolvedBoostSettings,
	safeReadJson,
} from "./boost-settings-parse.js";

export const DEFAULT_BOOST_SETTINGS: ResolvedBoostSettings = {
	mode: "single",
	profile: "balanced",
	panelSize: 3,
	models: DEFAULT_PANEL_MODELS,
	timeoutMs: DEFAULT_TIMEOUT_MS,
	agentSelfBoost: {
		enabled: false,
		maxYields: 3,
		maxPanelModels: 3,
		allowEnvironmental: false,
		allowCognitive: true,
	},
	sources: {
		mode: "default",
		profile: "default",
		panelSize: "default",
		models: "default",
		judge: "default",
		timeoutMs: "default",
		agentSelfBoost: "default",
	},
};

/** Resolve global settings followed by a trusted project override. */
export function resolveEffectiveBoostSettings(
	cwd: string = process.cwd(),
	isProjectTrusted = false,
	customGlobalPath?: string,
): ResolvedBoostSettings {
	const globalBoost = readBoostSettings(
		safeReadJson(customGlobalPath ?? PI_SETTINGS_PATH)?.boost,
	);
	const projectBoost = isProjectTrusted
		? readBoostSettings(safeReadJson(join(cwd, ".pi", "settings.json"))?.boost)
		: undefined;
	const effective: ResolvedBoostSettings = {
		...DEFAULT_BOOST_SETTINGS,
		agentSelfBoost: { ...DEFAULT_BOOST_SETTINGS.agentSelfBoost },
		sources: { ...DEFAULT_BOOST_SETTINGS.sources },
	};
	return applySettings(
		applySettings(effective, globalBoost, "global"),
		projectBoost,
		"project",
	);
}

/** Save only the selected standard Pi settings scope under the namespaced `boost` key. */
export async function saveBoostSettings(
	scope: "global" | "project",
	updates: Partial<BoostSettings>,
	cwd: string = process.cwd(),
	customGlobalPath?: string,
): Promise<void> {
	const targetPath =
		scope === "global"
			? (customGlobalPath ?? PI_SETTINGS_PATH)
			: join(cwd, ".pi", "settings.json");
	await withAdvisoryLock(targetPath, async () => {
		const existing = safeReadJson(targetPath) ?? {};
		const existingBoost = isRecord(existing.boost) ? existing.boost : {};
		const nextBoost = {
			...existingBoost,
			...updates,
			...(updates.agentSelfBoost
				? {
						agentSelfBoost: {
							...(isRecord(existingBoost.agentSelfBoost)
								? existingBoost.agentSelfBoost
								: {}),
							...updates.agentSelfBoost,
						},
					}
				: {}),
		};
		await writeFileAtomic(
			targetPath,
			`${JSON.stringify({ ...existing, boost: nextBoost }, null, 2)}\n`,
			{ mode: 0o600 },
		);
	});
}

/** Serialize overlay writes so rapid changes cannot reorder standard settings updates. */
export function createBoostSettingsWriter(
	cwd: string,
	customGlobalPath?: string,
	onError: (error: unknown) => void = () => undefined,
) {
	let pending: Promise<void> = Promise.resolve();
	return {
		enqueue(
			scope: "global" | "project",
			updates: Partial<BoostSettings>,
		): void {
			pending = pending
				.then(async () =>
					saveBoostSettings(scope, updates, cwd, customGlobalPath),
				)
				.catch((error: unknown) => {
					onError(error);
				});
		},
		async drain(): Promise<void> {
			await pending;
		},
	};
}
