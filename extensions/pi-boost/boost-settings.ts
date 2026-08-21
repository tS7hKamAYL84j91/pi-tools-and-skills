/** Boost settings reader, validated merger, and locked persistence through standard Pi settings files. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withAdvisoryLock } from "../../lib/file-lock.js";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { PI_SETTINGS_PATH } from "../../lib/pi-settings.js";
import {
	DEFAULT_PANEL_MODELS,
	type CognitiveProfile,
} from "./boost/cognitive-types.js";

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MODEL_ID = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/;
type SettingsSource = "default" | "global" | "project";

interface BoostAgentSelfBoostSettings {
	readonly enabled?: boolean;
	readonly maxYields?: number;
	readonly maxPanelModels?: number;
	readonly allowEnvironmental?: boolean;
	readonly allowCognitive?: boolean;
}

interface BoostSettings {
	readonly profile?: CognitiveProfile;
	readonly panelSize?: number;
	readonly models?: readonly string[];
	readonly judge?: string;
	readonly timeoutMs?: number;
	readonly agentSelfBoost?: BoostAgentSelfBoostSettings;
}

interface ResolvedBoostSettings {
	readonly profile: CognitiveProfile;
	readonly panelSize: number;
	readonly models: readonly string[];
	readonly judge?: string;
	readonly timeoutMs: number;
	readonly agentSelfBoost: {
		readonly enabled: boolean;
		readonly maxYields: number;
		readonly maxPanelModels: number;
		readonly allowEnvironmental: boolean;
		readonly allowCognitive: boolean;
	};
	readonly sources: {
		readonly profile: SettingsSource;
		readonly panelSize: SettingsSource;
		readonly models: SettingsSource;
		readonly judge: SettingsSource;
		readonly timeoutMs: SettingsSource;
		readonly agentSelfBoost: SettingsSource;
	};
}

export const DEFAULT_BOOST_SETTINGS: ResolvedBoostSettings = {
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
		profile: "default",
		panelSize: "default",
		models: "default",
		judge: "default",
		timeoutMs: "default",
		agentSelfBoost: "default",
	},
};

function safeReadJson(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoostSettings(value: unknown): BoostSettings | undefined {
	if (!isRecord(value)) return undefined;
	const profile = value.profile === "fast" || value.profile === "balanced" || value.profile === "thorough"
		? value.profile
		: undefined;
	const panelSize = boundedInteger(value.panelSize, 1, 4);
	const models = readModels(value.models);
	const judge = typeof value.judge === "string" && MODEL_ID.test(value.judge) ? value.judge : undefined;
	const timeoutMs = boundedInteger(value.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
	const agentSelfBoost = readAgentSettings(value.agentSelfBoost);
	return {
		...(profile ? { profile } : {}),
		...(panelSize ? { panelSize } : {}),
		...(models ? { models } : {}),
		...(judge ? { judge } : {}),
		...(timeoutMs ? { timeoutMs } : {}),
		...(agentSelfBoost ? { agentSelfBoost } : {}),
	};
}

function readAgentSettings(value: unknown): BoostAgentSelfBoostSettings | undefined {
	if (!isRecord(value)) return undefined;
	const enabled = typeof value.enabled === "boolean" ? value.enabled : undefined;
	const maxYields = boundedInteger(value.maxYields, 1, 3);
	const maxPanelModels = boundedInteger(value.maxPanelModels, 1, 4);
	const allowEnvironmental = typeof value.allowEnvironmental === "boolean" ? value.allowEnvironmental : undefined;
	const allowCognitive = typeof value.allowCognitive === "boolean" ? value.allowCognitive : undefined;
	if (enabled === undefined && maxYields === undefined && maxPanelModels === undefined && allowEnvironmental === undefined && allowCognitive === undefined) {
		return undefined;
	}
	return {
		...(enabled !== undefined ? { enabled } : {}),
		...(maxYields !== undefined ? { maxYields } : {}),
		...(maxPanelModels !== undefined ? { maxPanelModels } : {}),
		...(allowEnvironmental !== undefined ? { allowEnvironmental } : {}),
		...(allowCognitive !== undefined ? { allowCognitive } : {}),
	};
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
		? value
		: undefined;
}

function readModels(value: unknown): readonly string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const models = [...new Set(value.filter((item): item is string => typeof item === "string" && MODEL_ID.test(item)))].slice(0, 4);
	return models.length > 0 ? models : undefined;
}

/** Resolve global settings followed by a trusted project override. */
export function resolveEffectiveBoostSettings(
	cwd: string = process.cwd(),
	isProjectTrusted = false,
	customGlobalPath?: string,
): ResolvedBoostSettings {
	const globalBoost = readBoostSettings(safeReadJson(customGlobalPath ?? PI_SETTINGS_PATH)?.boost);
	const projectBoost = isProjectTrusted
		? readBoostSettings(safeReadJson(join(cwd, ".pi", "settings.json"))?.boost)
		: undefined;
	const effective: ResolvedBoostSettings = {
		...DEFAULT_BOOST_SETTINGS,
		agentSelfBoost: { ...DEFAULT_BOOST_SETTINGS.agentSelfBoost },
		sources: { ...DEFAULT_BOOST_SETTINGS.sources },
	};
	return applySettings(applySettings(effective, globalBoost, "global"), projectBoost, "project");
}

function applySettings(
	current: ResolvedBoostSettings,
	next: BoostSettings | undefined,
	source: SettingsSource,
): ResolvedBoostSettings {
	if (!next) return current;
	return {
		profile: next.profile ?? current.profile,
		panelSize: next.panelSize ?? current.panelSize,
		models: next.models ?? current.models,
		...(next.judge !== undefined ? { judge: next.judge } : current.judge !== undefined ? { judge: current.judge } : {}),
		timeoutMs: next.timeoutMs ?? current.timeoutMs,
		agentSelfBoost: next.agentSelfBoost
			? { ...current.agentSelfBoost, ...next.agentSelfBoost }
			: current.agentSelfBoost,
		sources: {
			profile: next.profile !== undefined ? source : current.sources.profile,
			panelSize: next.panelSize !== undefined ? source : current.sources.panelSize,
			models: next.models !== undefined ? source : current.sources.models,
			judge: next.judge !== undefined ? source : current.sources.judge,
			timeoutMs: next.timeoutMs !== undefined ? source : current.sources.timeoutMs,
			agentSelfBoost: next.agentSelfBoost !== undefined ? source : current.sources.agentSelfBoost,
		},
	};
}

/** Save only the selected standard Pi settings scope under the namespaced `boost` key. */
export async function saveBoostSettings(
	scope: "global" | "project",
	updates: Partial<BoostSettings>,
	cwd: string = process.cwd(),
	customGlobalPath?: string,
): Promise<void> {
	const targetPath = scope === "global" ? (customGlobalPath ?? PI_SETTINGS_PATH) : join(cwd, ".pi", "settings.json");
	await withAdvisoryLock(targetPath, async () => {
		const existing = safeReadJson(targetPath) ?? {};
		const existingBoost = isRecord(existing.boost) ? existing.boost : {};
		const nextBoost = {
			...existingBoost,
			...updates,
			...(updates.agentSelfBoost
				? { agentSelfBoost: { ...(isRecord(existingBoost.agentSelfBoost) ? existingBoost.agentSelfBoost : {}), ...updates.agentSelfBoost } }
				: {}),
		};
		await writeFileAtomic(targetPath, `${JSON.stringify({ ...existing, boost: nextBoost }, null, 2)}\n`, { mode: 0o600 });
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
		enqueue(scope: "global" | "project", updates: Partial<BoostSettings>): void {
			pending = pending
				.then(async () => saveBoostSettings(scope, updates, cwd, customGlobalPath))
				.catch((error: unknown) => { onError(error); });
		},
		async drain(): Promise<void> {
			await pending;
		},
	};
}
