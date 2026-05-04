/**
 * Shared paths for declarative team discovery and persistence.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PI_SETTINGS_PATH, readPiSettingsKey } from "../../lib/pi-settings.js";
import type { TeamDirectories, TeamRegistryOptions, TeamWritableSource } from "./team-types.js";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONFIG_JSON = join(EXTENSION_DIR, "config", "config.json");
const DEFAULT_AGENT_DIRECTORY = "agents";
const DEFAULT_PROMPT_DIRECTORY = "prompts";
export const DEFAULT_TEAM_DIRECTORY = "teams";
export const DEFAULT_USER_ROOT = join(homedir(), ".pi", "agent");
const DEFAULT_USER_TEAM_ROOT = join(DEFAULT_USER_ROOT, "teams");
const PROJECT_SETTINGS_PATH = join(".pi", "settings.json");
const PROJECT_TEAM_ROOT = join(".pi", "teams");

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const values = value
		.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		.map((item) => item.trim());
	return values.length > 0 ? values : undefined;
}

function expandRoot(root: string, cwd: string): string {
	if (root === "~") return homedir();
	if (root.startsWith("~/")) return join(homedir(), root.slice(2));
	return isAbsolute(root) ? root : resolve(cwd, root);
}

function configuredRoots(settingsPath: string, cwd: string): string[] | undefined {
	const settings = readPiSettingsKey("teams", settingsPath);
	const roots = isRecord(settings) ? stringArray(settings.roots) : undefined;
	return roots?.map((root) => expandRoot(root, cwd));
}

function directoriesForRoot(root: string, source: TeamDirectories["source"]): TeamDirectories {
	return {
		source,
		root,
		agents: join(root, DEFAULT_AGENT_DIRECTORY),
		prompts: join(root, DEFAULT_PROMPT_DIRECTORY),
		teams: join(root, DEFAULT_TEAM_DIRECTORY),
	};
}

function readBuiltinTeamDirectories(configPath: string = DEFAULT_CONFIG_JSON): TeamDirectories {
	return directoriesForRoot(dirname(configPath), "builtin");
}

function findProjectRoot(start: string): string {
	let dir = start;
	let parent = dirname(dir);
	while (dir !== parent) {
		if (existsSync(join(dir, "package.json"))) return dir;
		if (existsSync(join(dir, ".git"))) return dir;
		dir = parent;
		parent = dirname(dir);
	}
	return start;
}

export function teamDirectories(
	configPath: string,
	options: TeamRegistryOptions = {},
): TeamDirectories[] {
	const cwd = options.cwd ?? process.cwd();
	const dirs = [readBuiltinTeamDirectories(configPath)];
	if (options.roots) {
		for (const root of options.roots) dirs.push(directoriesForRoot(root, "user"));
		return dirs;
	}
	const userRoots = configuredRoots(options.settingsPath ?? PI_SETTINGS_PATH, cwd) ?? [DEFAULT_USER_TEAM_ROOT];
	for (const root of userRoots) dirs.push(directoriesForRoot(root, "user"));
	const projectRoot = findProjectRoot(cwd);
	const projectRoots = configuredRoots(join(projectRoot, PROJECT_SETTINGS_PATH), projectRoot) ?? [];
	for (const root of projectRoots) dirs.push(directoriesForRoot(root, "project"));
	return dirs;
}

export function dirsForTeamScope(scope: TeamWritableSource, cwd: string): { teams: string; agents: string; prompts: string } {
	const root = scope === "project" ? join(findProjectRoot(cwd), PROJECT_TEAM_ROOT) : DEFAULT_USER_TEAM_ROOT;
	const dirs = directoriesForRoot(root, scope);
	return { teams: dirs.teams, agents: dirs.agents, prompts: dirs.prompts };
}
