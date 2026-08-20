/** CoAS configuration discovery shared across extensions. */

import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { readPiSettingsKey } from "./pi-settings.js";
import { pathInside } from "./path-inside.js";
import type { CoasConfig } from "./coas-types.js";

interface RawCoasSettings {
	coasHome?: unknown;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readCoasSettings(path?: string): RawCoasSettings | undefined {
	const value = readPiSettingsKey("coas", path);
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as RawCoasSettings;
	}
	return undefined;
}

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

function defaultCoasHome(): string {
	const agentHome = process.env.AGENT_HOME && process.env.AGENT_HOME.trim().length > 0
		? expandHome(process.env.AGENT_HOME)
		: homedir();
	return join(agentHome, ".pi", "coas");
}

function nearestProjectCoasHome(cwd: string): string | undefined {
	let current = resolve(cwd);
	const root = parse(current).root;
	while (true) {
		const candidate = join(current, ".pi", "coas");
		if (existsSync(join(candidate, "workspace"))) return candidate;
		if (current === root) return undefined;
		current = dirname(current);
	}
}

export function resolveCoasConfig(cwd: string = process.cwd()): CoasConfig {
	const projectSettings = readCoasSettings(join(cwd, ".pi", "settings.json"));
	const globalSettings = readCoasSettings();
	const coasHome =
		process.env.COAS_HOME ??
		optionalString(projectSettings?.coasHome) ??
		nearestProjectCoasHome(cwd) ??
		optionalString(globalSettings?.coasHome) ??
		defaultCoasHome();
	return { coasHome: resolve(expandHome(coasHome)) };
}

export async function resolveCoasConfigForCwd(baseCwd: string, cwd?: string): Promise<CoasConfig> {
	const resolvedCwd = cwd ? resolve(cwd) : baseCwd;
	if (cwd) {
		const info = await stat(resolvedCwd).catch(() => undefined);
		if (!info?.isDirectory()) {
			throw new Error(`No such directory: ${cwd}`);
		}
	}
	const config = resolveCoasConfig(resolvedCwd);
	if (cwd && !pathInside(resolvedCwd, config.coasHome)) {
		throw new Error(`No CoAS runtime found under ${resolvedCwd} (resolved COAS_HOME=${config.coasHome})`);
	}
	return config;
}
