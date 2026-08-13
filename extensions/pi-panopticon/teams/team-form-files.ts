/**
 * Filesystem mutation helpers for team form creation and deletion.
 */

import * as nodeFs from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { writeFileAtomic } from "../../../lib/file-persistence.js";
import { assertPrivateFileTarget, ensurePrivateDirectory } from "../../../lib/private-local-mode.js";
import { isLiveAgentRef } from "./live-agent.js";
import { quoteYamlString } from "./team-form-yaml.js";
import { dirsForTeamScope } from "./team-paths.js";
import { loadTeamRegistry } from "./team-registry.js";
import type { TeamSpec } from "./team-types.js";

const SAFE_GENERATED_SUBAGENT_ID = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

function titleFromId(id: string): string {
	return id.split(/[-_]/).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export function assertSafeGeneratedSubagentId(id: string): void {
	if (!SAFE_GENERATED_SUBAGENT_ID.test(id) || id.includes("..")) {
		throw new Error(`Invalid generated subagent id "${id}". Use a lowercase basename containing only letters, numbers, dots, underscores, or hyphens, with an alphanumeric start and end.`);
	}
}

export function assertGeneratedSubagentsDirectory(dir: string): void {
	assertPrivateFileTarget(resolve(dir, ".pi-teams-directory-boundary"));
}

export function ensureGeneratedSubagentsDirectory(dir: string): void {
	assertGeneratedSubagentsDirectory(dir);
	ensurePrivateDirectory(resolve(dir));
}

export function assertTeamDefinitionsDirectory(dir: string): void {
	assertPrivateFileTarget(resolve(dir, ".pi-teams-directory-boundary"));
}

export function ensureTeamDefinitionsDirectory(dir: string): void {
	assertTeamDefinitionsDirectory(dir);
	ensurePrivateDirectory(resolve(dir));
}

export function assertTeamDefinitionFile(path: string): void {
	assertTeamDefinitionsDirectory(dirname(resolve(path)));
	assertPrivateFileTarget(resolve(path));
}

function confinedSubagentPath(dir: string, id: string): string {
	assertSafeGeneratedSubagentId(id);
	const root = resolve(dir);
	const path = resolve(root, `${id}.md`);
	const pathFromRoot = relative(root, path);
	if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
		throw new Error(`Generated subagent path escapes agents directory: ${id}`);
	}
	return path;
}

export async function ensureSubagentFile(dir: string, id: string): Promise<string> {
	const path = confinedSubagentPath(dir, id);
	ensureGeneratedSubagentsDirectory(dir);
	assertPrivateFileTarget(path);
	if (nodeFs.existsSync(path)) return path;
	await writeFileAtomic(
		path,
		[
			"---",
			`name: ${quoteYamlString(id)}`,
			'version: "1.0.0"',
			`description: ${quoteYamlString(`${titleFromId(id)} team role.`)}`,
			'generatedBy: "pi-teams"',
			"tools: []",
			"---",
			"",
			"# IDENTITY",
			"",
			`You are ${titleFromId(id)}.`,
			"",
			"# CONSTRAINTS",
			"",
			"- Stay within the requested scope.",
			"- Be concise, technical, and explicit about uncertainty.",
			"",
			"# HANDBACK PROTOCOL",
			"",
			"Return SUMMARY, OUTPUT, and STATUS.",
		].join("\n"),
		{ encoding: "utf8" }
	);
	return path;
}

async function isGeneratedSubagent(path: string): Promise<boolean> {
	try {
		return (await readFile(path, "utf8")).includes('generatedBy: "pi-teams"');
	} catch {
		return false;
	}
}

export async function deleteGeneratedSubagents(team: TeamSpec, cwd: string): Promise<void> {
	if (team.source === "builtin") return;
	const filesystemSubagents = team.agents.filter((subagent) => !isLiveAgentRef(subagent));
	if (filesystemSubagents.length === 0) return;
	const agentsDir = dirsForTeamScope(team.source, cwd).agents;
	assertGeneratedSubagentsDirectory(agentsDir);
	const registry = loadTeamRegistry(undefined, { cwd });
	const referenced = new Set(
		[...registry.teams.values()]
			.filter((entry) => entry.id !== team.id)
			.flatMap((entry) => entry.agents),
	);
	const candidates = filesystemSubagents
		.filter((subagent) => !referenced.has(subagent))
		.map((subagent) => confinedSubagentPath(agentsDir, subagent));
	for (const candidate of candidates) {
		assertPrivateFileTarget(candidate);
		if (await isGeneratedSubagent(candidate)) await rm(candidate).catch(() => {});
	}
}
