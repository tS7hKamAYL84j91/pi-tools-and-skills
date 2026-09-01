/** Boost settings schema types and validated readers for standard Pi settings payloads. */

import { existsSync, readFileSync } from "node:fs";

export const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const MODEL_ID = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/;

export type SettingsSource = "default" | "global" | "project";

export interface BoostAgentSelfBoostSettings {
	readonly enabled?: boolean;
	readonly maxYields?: number;
	readonly maxPanelModels?: number;
	readonly allowEnvironmental?: boolean;
	readonly allowCognitive?: boolean;
}

export type BoostMode = "single" | "fusion";

export interface BoostSettings {
	readonly mode?: BoostMode;
	readonly profile?: CognitiveProfile;
	readonly panelSize?: number;
	readonly models?: readonly string[];
	readonly judge?: string;
	readonly timeoutMs?: number;
	readonly agentSelfBoost?: BoostAgentSelfBoostSettings;
}

export interface ResolvedBoostSettings {
	readonly mode: BoostMode;
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
		readonly mode: SettingsSource;
		readonly profile: SettingsSource;
		readonly panelSize: SettingsSource;
		readonly models: SettingsSource;
		readonly judge: SettingsSource;
		readonly timeoutMs: SettingsSource;
		readonly agentSelfBoost: SettingsSource;
	};
}

import type { CognitiveProfile } from "./boost/cognitive-types.js";

export function safeReadJson(
	path: string,
): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readBoostSettings(value: unknown): BoostSettings | undefined {
	if (!isRecord(value)) return undefined;
	const mode =
		value.mode === "single" || value.mode === "fusion" ? value.mode : undefined;
	const profile =
		value.profile === "fast" ||
		value.profile === "balanced" ||
		value.profile === "thorough"
			? value.profile
			: undefined;
	const panelSize = boundedInteger(value.panelSize, 1, 4);
	const models = readModels(value.models);
	const judge =
		typeof value.judge === "string" && MODEL_ID.test(value.judge)
			? value.judge
			: undefined;
	const timeoutMs = boundedInteger(
		value.timeoutMs,
		MIN_TIMEOUT_MS,
		MAX_TIMEOUT_MS,
	);
	const agentSelfBoost = readAgentSettings(value.agentSelfBoost);
	return {
		...(mode ? { mode } : {}),
		...(profile ? { profile } : {}),
		...(panelSize ? { panelSize } : {}),
		...(models ? { models } : {}),
		...(judge ? { judge } : {}),
		...(timeoutMs ? { timeoutMs } : {}),
		...(agentSelfBoost ? { agentSelfBoost } : {}),
	};
}

function readAgentSettings(
	value: unknown,
): BoostAgentSelfBoostSettings | undefined {
	if (!isRecord(value)) return undefined;
	const enabled =
		typeof value.enabled === "boolean" ? value.enabled : undefined;
	const maxYields = boundedInteger(value.maxYields, 1, 3);
	const maxPanelModels = boundedInteger(value.maxPanelModels, 1, 4);
	const allowEnvironmental =
		typeof value.allowEnvironmental === "boolean"
			? value.allowEnvironmental
			: undefined;
	const allowCognitive =
		typeof value.allowCognitive === "boolean"
			? value.allowCognitive
			: undefined;
	if (
		enabled === undefined &&
		maxYields === undefined &&
		maxPanelModels === undefined &&
		allowEnvironmental === undefined &&
		allowCognitive === undefined
	) {
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

function boundedInteger(
	value: unknown,
	minimum: number,
	maximum: number,
): number | undefined {
	return typeof value === "number" &&
		Number.isInteger(value) &&
		value >= minimum &&
		value <= maximum
		? value
		: undefined;
}

function readModels(value: unknown): readonly string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const models = [
		...new Set(
			value.filter(
				(item): item is string =>
					typeof item === "string" && MODEL_ID.test(item),
			),
		),
	].slice(0, 4);
	return models.length > 0 ? models : undefined;
}

export function applySettings(
	current: ResolvedBoostSettings,
	next: BoostSettings | undefined,
	source: SettingsSource,
): ResolvedBoostSettings {
	if (!next) return current;
	return {
		profile: next.profile ?? current.profile,
		panelSize: next.panelSize ?? current.panelSize,
		mode: next.mode ?? current.mode,
		models: next.models ?? current.models,
		...(next.judge !== undefined
			? { judge: next.judge }
			: current.judge !== undefined
				? { judge: current.judge }
				: {}),
		timeoutMs: next.timeoutMs ?? current.timeoutMs,
		agentSelfBoost: next.agentSelfBoost
			? { ...current.agentSelfBoost, ...next.agentSelfBoost }
			: current.agentSelfBoost,
		sources: {
			mode: next.mode !== undefined ? source : current.sources.mode,
			profile: next.profile !== undefined ? source : current.sources.profile,
			panelSize:
				next.panelSize !== undefined ? source : current.sources.panelSize,
			models: next.models !== undefined ? source : current.sources.models,
			judge: next.judge !== undefined ? source : current.sources.judge,
			timeoutMs:
				next.timeoutMs !== undefined ? source : current.sources.timeoutMs,
			agentSelfBoost:
				next.agentSelfBoost !== undefined
					? source
					: current.sources.agentSelfBoost,
		},
	};
}
