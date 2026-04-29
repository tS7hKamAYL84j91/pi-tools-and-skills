/**
 * CoAS extension configuration discovery.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readPiSettingsKey } from "../../lib/pi-settings.js";
import type { CoasConfig, RawCoasSettings } from "./types.js";

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

export function resolveCoasConfig(cwd: string = process.cwd()): CoasConfig {
	const projectSettings = readCoasSettings(join(cwd, ".pi", "settings.json"));
	const globalSettings = readCoasSettings();
	const settings = projectSettings ?? globalSettings;
	const coasDir =
		process.env.COAS_DIR ??
		optionalString(settings?.coasDir) ??
		join(homedir(), "git", "coas");
	const coasHome =
		process.env.COAS_HOME ??
		optionalString(settings?.coasHome) ??
		join(homedir(), ".coas");
	return {
		coasDir: resolve(expandHome(coasDir)),
		coasHome: resolve(expandHome(coasHome)),
	};
}

export function hasCoasScripts(config: CoasConfig): boolean {
	return existsSync(join(config.coasDir, "scripts", "coas-status")) &&
		existsSync(join(config.coasDir, "scripts", "coas-doctor")) &&
		existsSync(join(config.coasDir, "scripts", "coas-schedule"));
}

export function coasScript(config: CoasConfig, name: string): string {
	return join(config.coasDir, "scripts", name);
}
