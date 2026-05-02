/**
 * Shared paths for declarative team discovery and persistence.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TeamDirectories, TeamRegistryOptions, TeamWritableSource } from "./team-types.js";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONFIG_JSON = join(EXTENSION_DIR, "config", "config.json");
export const DEFAULT_SUBAGENT_DIRECTORY = "subagents";
export const DEFAULT_TEAM_DIRECTORY = "teams";
export const DEFAULT_USER_ROOT = join(homedir(), ".pi", "agent");

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

export function readBuiltinTeamDirectories(configPath: string): TeamDirectories {
	try {
		const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
		const config = isRecord(raw) ? raw : {};
		const configDir = dirname(configPath);
		return {
			source: "builtin",
			subagents: join(
				configDir,
				optionalString(config.subagentDirectory) ?? DEFAULT_SUBAGENT_DIRECTORY,
			),
			teams: join(
				configDir,
				optionalString(config.teamDirectory) ?? DEFAULT_TEAM_DIRECTORY,
			),
		};
	} catch {
		return {
			source: "builtin",
			subagents: join(dirname(configPath), DEFAULT_SUBAGENT_DIRECTORY),
			teams: join(dirname(configPath), DEFAULT_TEAM_DIRECTORY),
		};
	}
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
	const dirs = [readBuiltinTeamDirectories(configPath)];
	const userRoot = options.userRoot ?? DEFAULT_USER_ROOT;
	dirs.push({
		source: "user",
		subagents: join(userRoot, DEFAULT_SUBAGENT_DIRECTORY),
		teams: join(userRoot, DEFAULT_TEAM_DIRECTORY),
	});
	if (options.cwd) {
		const projectRoot = findProjectRoot(options.cwd);
		dirs.push({
			source: "project",
			subagents: join(projectRoot, ".pi", DEFAULT_SUBAGENT_DIRECTORY),
			teams: join(projectRoot, ".pi", DEFAULT_TEAM_DIRECTORY),
		});
	}
	return dirs;
}

export function dirsForTeamScope(scope: TeamWritableSource, cwd: string): { teams: string; subagents: string } {
	if (scope === "project") {
		const root = findProjectRoot(cwd);
		return {
			teams: join(root, ".pi", DEFAULT_TEAM_DIRECTORY),
			subagents: join(root, ".pi", DEFAULT_SUBAGENT_DIRECTORY),
		};
	}
	return {
		teams: join(DEFAULT_USER_ROOT, DEFAULT_TEAM_DIRECTORY),
		subagents: join(DEFAULT_USER_ROOT, DEFAULT_SUBAGENT_DIRECTORY),
	};
}
