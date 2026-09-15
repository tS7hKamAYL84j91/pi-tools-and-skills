/** Automations configuration discovery shared across extensions. */

import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { readPiSettingsKey } from "./pi-settings.js";
import { pathInside } from "./path-inside.js";
import type { AutomationsConfig } from "./automations-types.js";

interface RawAutomationsSettings {
	automationsHome?: unknown;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value
		: undefined;
}

function readAutomationsSettings(path?: string): RawAutomationsSettings | undefined {
	const value = readPiSettingsKey("automations", path);
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as RawAutomationsSettings;
	}
	return undefined;
}

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

function defaultAutomationsHome(cwd: string): string {
	return join(resolve(cwd), ".pi", "automations");
}

function nearestProjectAutomationsHome(cwd: string): string | undefined {
	let current = resolve(cwd);
	const root = parse(current).root;
	while (true) {
		const candidate = join(current, ".pi", "automations");
		if (existsSync(join(candidate, "workspace"))) return candidate;
		if (current === root) return undefined;
		current = dirname(current);
	}
}

export function resolveAutomationsConfig(
	cwd: string = process.cwd(),
	requireExistingRuntime = false,
): AutomationsConfig {
	const projectSettings = readAutomationsSettings(join(cwd, ".pi", "settings.json"));
	const globalSettings = readAutomationsSettings();
	const automationsHome =
		process.env.AUTOMATIONS_HOME ??
		optionalString(projectSettings?.automationsHome) ??
		nearestProjectAutomationsHome(cwd) ??
		optionalString(globalSettings?.automationsHome) ??
		(requireExistingRuntime ? undefined : defaultAutomationsHome(cwd));
	if (!automationsHome) {
		throw new Error(`No Automations runtime found under ${resolve(cwd)}`);
	}
	return { automationsHome: resolve(expandHome(automationsHome)) };
}

export async function resolveAutomationsConfigForCwd(
	baseCwd: string,
	cwd?: string,
): Promise<AutomationsConfig> {
	const resolvedCwd = cwd ? resolve(cwd) : baseCwd;
	if (cwd) {
		const info = await stat(resolvedCwd).catch(() => undefined);
		if (!info?.isDirectory()) {
			throw new Error(`No such directory: ${cwd}`);
		}
	}
	const config = resolveAutomationsConfig(resolvedCwd, cwd !== undefined);
	if (cwd && !pathInside(resolvedCwd, config.automationsHome)) {
		throw new Error(
			`No Automations runtime found under ${resolvedCwd} (resolved AUTOMATIONS_HOME=${config.automationsHome})`,
		);
	}
	return config;
}
