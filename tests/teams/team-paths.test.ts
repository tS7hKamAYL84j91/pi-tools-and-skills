/** ADR-047 characterization tests for Teams path discovery. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { teamDirectories } from "../../extensions/pi-teams/team-paths.js";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(directory);
	return directory;
}

function writeSettings(path: string, roots: string[]): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify({ teams: { roots } }), "utf8");
}

afterEach(() => {
	for (const directory of tempDirs.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("teamDirectories ADR-047 characterization", () => {
	it("preserves built-in, user, and project root order and source attribution", () => {
		const root = tempDir("team-paths-");
		const configPath = join(root, "builtin", "config.json");
		const project = join(root, "project");
		const settingsPath = join(root, "user", "settings.json");
		mkdirSync(project, { recursive: true });
		writeFileSync(join(project, "package.json"), "{}", "utf8");
		writeSettings(settingsPath, ["user-teams"]);
		writeSettings(join(project, ".pi", "settings.json"), ["project-teams"]);

		expect(teamDirectories(configPath, { cwd: project, settingsPath })).toEqual([
			{ source: "builtin", root: dirname(configPath), agents: join(dirname(configPath), "agents"), prompts: join(dirname(configPath), "prompts"), teams: join(dirname(configPath), "teams") },
			{ source: "user", root: join(project, "user-teams"), agents: join(project, "user-teams", "agents"), prompts: join(project, "user-teams", "prompts"), teams: join(project, "user-teams", "teams") },
			{ source: "project", root: join(project, "project-teams"), agents: join(project, "project-teams", "agents"), prompts: join(project, "project-teams", "prompts"), teams: join(project, "project-teams", "teams") },
		]);
	});

	it("preserves explicit roots, including duplicates, and skips settings/project discovery", () => {
		const root = tempDir("team-paths-explicit-");
		const configPath = join(root, "builtin", "config.json");
		const project = join(root, "project");
		const explicitRoot = join(root, "explicit");
		const settingsPath = join(root, "user", "settings.json");
		mkdirSync(project, { recursive: true });
		writeFileSync(join(project, "package.json"), "{}", "utf8");
		writeSettings(settingsPath, [join(root, "configured-user")]);
		writeSettings(join(project, ".pi", "settings.json"), [join(root, "configured-project")]);

		const directories = teamDirectories(configPath, {
			cwd: project,
			settingsPath,
			roots: [explicitRoot, explicitRoot],
		});

		expect(directories.map(({ source, root: directoryRoot }) => ({ source, root: directoryRoot }))).toEqual([
			{ source: "builtin", root: dirname(configPath) },
			{ source: "user", root: explicitRoot },
			{ source: "user", root: explicitRoot },
		]);
	});
});
