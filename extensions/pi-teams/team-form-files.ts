/**
 * Filesystem mutation helpers for team form creation and deletion.
 */

import * as nodeFs from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { isLiveAgentRef } from "./live-agent.js";
import { quoteYamlString } from "./team-form-yaml.js";
import { dirsForTeamScope } from "./team-paths.js";
import { loadTeamRegistry } from "./team-registry.js";
import type { TeamSpec } from "./team-types.js";

function titleFromId(id: string): string {
	return id.split(/[-_]/).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export async function ensureSubagentFile(dir: string, id: string): Promise<string> {
	await mkdir(dir, { recursive: true });
	const path = join(dir, `${id}.md`);
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
	const registry = loadTeamRegistry(undefined, { cwd });
	const referenced = new Set(
		[...registry.teams.values()]
			.filter((entry) => entry.id !== team.id)
			.flatMap((entry) => entry.agents),
	);
	const agentsDir = dirsForTeamScope(team.source, cwd).agents;
	for (const subagent of team.agents) {
		if (referenced.has(subagent) || isLiveAgentRef(subagent)) continue;
		const path = join(agentsDir, `${subagent}.md`);
		if (await isGeneratedSubagent(path)) await rm(path).catch(() => {});
	}
}
