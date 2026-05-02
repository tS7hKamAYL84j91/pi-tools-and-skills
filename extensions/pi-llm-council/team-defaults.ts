/**
 * User-level default team seeding.
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { readMarkdownDescriptors } from "./front-matter.js";
import {
	DEFAULT_CONFIG_JSON,
	DEFAULT_SUBAGENT_DIRECTORY,
	DEFAULT_TEAM_DIRECTORY,
	DEFAULT_USER_ROOT,
	readBuiltinTeamDirectories,
} from "./team-paths.js";

function copyMissingMarkdownFiles(sourceDir: string, targetDir: string): void {
	if (!existsSync(sourceDir)) return;
	mkdirSync(targetDir, { recursive: true });
	for (const descriptor of readMarkdownDescriptors(sourceDir)) {
		const target = join(targetDir, basename(descriptor.path));
		if (!existsSync(target)) copyFileSync(descriptor.path, target);
	}
}

export function ensureUserTeamDefaults(
	userRoot: string = DEFAULT_USER_ROOT,
	configPath: string = DEFAULT_CONFIG_JSON,
): void {
	const builtin = readBuiltinTeamDirectories(configPath);
	copyMissingMarkdownFiles(builtin.teams, join(userRoot, DEFAULT_TEAM_DIRECTORY));
	copyMissingMarkdownFiles(builtin.subagents, join(userRoot, DEFAULT_SUBAGENT_DIRECTORY));
}
