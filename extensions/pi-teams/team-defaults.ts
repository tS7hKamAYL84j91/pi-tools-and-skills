/**
 * User-level default team seeding.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, basename } from "node:path";
import { PI_SETTINGS_PATH } from "../../lib/pi-settings.js";
import { readMarkdownDescriptors } from "./front-matter.js";
import {
	DEFAULT_CONFIG_JSON,
	DEFAULT_USER_TEAM_ROOT,
	directoriesForRoot,
	readBuiltinTeamDirectories,
} from "./team-paths.js";

const DEFAULT_TEAM_ROOTS = ["~/.pi/agent/teams"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function copyMissingMarkdownFiles(sourceDir: string, targetDir: string): void {
	if (!existsSync(sourceDir)) return;
	mkdirSync(targetDir, { recursive: true });
	for (const descriptor of readMarkdownDescriptors(sourceDir)) {
		const target = `${targetDir}/${basename(descriptor.path)}`;
		if (!existsSync(target)) copyFileSync(descriptor.path, target);
	}
}

export function ensureTeamsSettingsDefaults(settingsPath: string = PI_SETTINGS_PATH): void {
	let settings: Record<string, unknown> = {};
	try {
		settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
	} catch {
		settings = {};
	}
	const teams = isRecord(settings.teams) ? settings.teams : {};
	if (Array.isArray(teams.roots)) return;
	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(
		settingsPath,
		`${JSON.stringify(
			{
				...settings,
				teams: {
					...teams,
					roots: [...DEFAULT_TEAM_ROOTS],
				},
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
}

export function ensureUserTeamDefaults(
	userRoot: string = DEFAULT_USER_TEAM_ROOT,
	configPath: string = DEFAULT_CONFIG_JSON,
): void {
	if (userRoot === DEFAULT_USER_TEAM_ROOT) ensureTeamsSettingsDefaults();
	const builtin = readBuiltinTeamDirectories(configPath);
	const user = directoriesForRoot(userRoot, "user");
	copyMissingMarkdownFiles(builtin.teams, user.teams);
	copyMissingMarkdownFiles(builtin.agents, user.agents);
	copyMissingMarkdownFiles(builtin.prompts, user.prompts);
}
