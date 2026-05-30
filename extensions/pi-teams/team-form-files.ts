/**
 * Filesystem mutation helpers for team form creation and deletion.
 */

import * as nodeFs from "node:fs";
import { join } from "node:path";
import { isLiveAgentRef } from "./live-agent.js";
import { quoteYamlString } from "./team-form-yaml.js";
import { dirsForTeamScope } from "./team-paths.js";
import { loadTeamRegistry } from "./team-registry.js";
import type { TeamSpec } from "./team-types.js";

function titleFromId(id: string): string {
	return id.split(/[-_]/).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export function ensureSubagentFile(dir: string, id: string): string {
	nodeFs.mkdirSync(dir, { recursive: true });
	const path = join(dir, `${id}.md`);
	if (nodeFs.existsSync(path)) return path;
	nodeFs.writeFileSync(
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
		"utf8",
	);
	return path;
}

function isGeneratedSubagent(path: string): boolean {
	try {
		return nodeFs.readFileSync(path, "utf8").includes('generatedBy: "pi-teams"');
	} catch {
		return false;
	}
}

export function deleteGeneratedSubagents(team: TeamSpec, cwd: string): void {
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
		if (isGeneratedSubagent(path)) nodeFs.unlinkSync(path);
	}
}
