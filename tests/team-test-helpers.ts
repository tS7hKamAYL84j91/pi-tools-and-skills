/**
 * Shared test helpers for pi-teams registry/tool tests.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolResult } from "../lib/tool-result.js";

interface RegisteredTool {
	name: string;
	execute: (
		id: string,
		params: { id?: string; prompt?: string; scope?: "user" | "project"; runId?: string; reason?: string },
		signal?: AbortSignal,
		onUpdate?: unknown,
		ctx?: unknown,
	) => Promise<ToolResult>;
}

export function withTempConfig(fn: (configPath: string, root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "team-registry-"));
	try {
		mkdirSync(join(root, "agents"));
		mkdirSync(join(root, "teams"));
		const configPath = join(root, "config.json");
		writeFileSync(configPath, JSON.stringify({ layout: "teams-root" }), "utf8");
		fn(configPath, root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

export function writeSubagent(root: string, name: string): void {
	writeFileSync(
		join(root, "agents", `${name}.md`),
		["---", `name: "${name}"`, `promptId: "${name}System"`, "---", "Subagent body."].join("\n"),
		"utf8",
	);
}

export function writeTeam(root: string, id: string, agent: string): void {
	writeFileSync(
		join(root, "teams", `${id}.md`),
		[
			"---",
			"schemaVersion: 2",
			`id: "${id}"`,
			`name: "${id}"`,
			'protocol: "consult"',
			"agents:",
			'  - role: "navigator"',
			`    subagent: "${agent}"`,
			"---",
			"Team body.",
		].join("\n"),
		"utf8",
	);
}

export function createFakeApi(): { tools: Map<string, RegisteredTool>; api: ExtensionAPI } {
	const tools = new Map<string, RegisteredTool>();
	return {
		tools,
		api: {
			registerTool(tool: RegisteredTool) {
				tools.set(tool.name, tool);
			},
		} as unknown as ExtensionAPI,
	};
}
