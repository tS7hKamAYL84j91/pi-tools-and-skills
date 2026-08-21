/** Shared paths for declarative team discovery and persistence. */

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	discoverDeclarativeRoots,
	findDeclarativeProjectRoot,
} from "../../lib/declarative-discovery.js";
import { PI_SETTINGS_PATH, readPiSettingsKey } from "../../lib/pi-settings.js";
import type { TeamDirectories, TeamRegistryOptions, TeamWritableSource } from "./team-types.js";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONFIG_JSON = join(EXTENSION_DIR, "config", "config.json");
const DEFAULT_AGENT_DIRECTORY = "agents";
const DEFAULT_PROMPT_DIRECTORY = "prompts";
const DEFAULT_TEAM_DIRECTORY = "teams";
const DEFAULT_RESULT_DIRECTORY = "results";
const DEFAULT_USER_ROOT = join(homedir(), ".pi", "agent");
const DEFAULT_USER_TEAM_ROOT = join(DEFAULT_USER_ROOT, "teams");
const PROJECT_SETTINGS_PATH = join(".pi", "settings.json");
const PROJECT_TEAM_ROOT = join(".pi", "teams");

function directoriesForRoot(root: string, source: TeamDirectories["source"]): TeamDirectories {
	return {
		source,
		root,
		agents: join(root, DEFAULT_AGENT_DIRECTORY),
		prompts: join(root, DEFAULT_PROMPT_DIRECTORY),
		teams: join(root, DEFAULT_TEAM_DIRECTORY),
	};
}

function rootsForTeams(configPath: string, options: TeamRegistryOptions): ReturnType<typeof discoverDeclarativeRoots> {
	const cwd = options.cwd ?? process.cwd();
	return discoverDeclarativeRoots({
		configPath,
		settingsKey: "teams",
		readSettingsKey: readPiSettingsKey,
		userSettingsPath: options.settingsPath ?? PI_SETTINGS_PATH,
		userFallbackRoot: DEFAULT_USER_TEAM_ROOT,
		projectSettingsRelativePath: PROJECT_SETTINGS_PATH,
		projectFallbackRoot: PROJECT_TEAM_ROOT,
		cwd,
		roots: options.roots,
	});
}

export function teamDirectories(
	configPath: string,
	options: TeamRegistryOptions = {},
): TeamDirectories[] {
	return rootsForTeams(configPath, options).map(({ root, source }) => directoriesForRoot(root, source));
}

/** Resolve the private user-owned root for durable team-run results. */
export function resolveTeamResultRoot(
	cwd: string,
	settingsPath: string = PI_SETTINGS_PATH,
): string {
	const roots = rootsForTeams(DEFAULT_CONFIG_JSON, { cwd, settingsPath });
	const userRoot = roots.find((root) => root.source === "user")?.root ?? DEFAULT_USER_TEAM_ROOT;
	return join(userRoot, DEFAULT_RESULT_DIRECTORY);
}

export function dirsForTeamScope(scope: TeamWritableSource, cwd: string): { teams: string; agents: string; prompts: string } {
	const projectRoot = findDeclarativeProjectRoot(cwd);
	const roots = rootsForTeams(DEFAULT_CONFIG_JSON, {
		cwd: scope === "project" ? projectRoot : cwd,
		settingsPath: scope === "project" ? join(projectRoot, PROJECT_SETTINGS_PATH) : PI_SETTINGS_PATH,
	});
	const root = roots.find((candidate) => candidate.source === scope)?.root ??
		(scope === "project" ? join(projectRoot, PROJECT_TEAM_ROOT) : DEFAULT_USER_TEAM_ROOT);
	const dirs = directoriesForRoot(root, scope);
	return { teams: dirs.teams, agents: dirs.agents, prompts: dirs.prompts };
}
