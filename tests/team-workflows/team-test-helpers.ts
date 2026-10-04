/**
 * Shared test helpers for pi-teams registry/tool tests.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ToolResult } from "../../lib/tool-result.js";

interface RegisteredTool {
	name: string;
	parameters?: unknown;
	execute: (
		id: string,
		params: {
			id?: string;
			prompt?: string;
			async?: boolean;
			profile?: "fast" | "balanced" | "thorough";
			scope?: "user" | "project";
			runId?: string;
			reason?: string;
		},
		signal?: AbortSignal,
		onUpdate?: unknown,
		ctx?: unknown,
	) => Promise<ToolResult>;
}

export function withTempConfig(
	fn: (configPath: string, root: string) => void,
): void {
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

export async function withTempProjectRoot(
	prefix: string,
	fn: (project: string) => void | Promise<void>,
): Promise<void> {
	const project = mkdtempSync(join(tmpdir(), prefix));
	try {
		writeFileSync(join(project, "package.json"), "{}", "utf8");
		await fn(project);
	} finally {
		rmSync(project, { recursive: true, force: true });
	}
}

function writeMarkdown(path: string, lines: string[]): void {
	writeFileSync(path, lines.join("\n"), "utf8");
}

export function writeSubagent(
	root: string,
	name: string,
	promptId: string | null = `${name}System`,
): void {
	writeMarkdown(join(root, "agents", `${name}.md`), [
		"---",
		`name: "${name}"`,
		...(promptId ? [`promptId: "${promptId}"`] : []),
		"---",
		"Subagent body.",
	]);
}

export function writeTeam(root: string, id: string, agent: string): void {
	writeMarkdown(join(root, "teams", `${id}.md`), [
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
	]);
}

export function writeConsultTeam(
	root: string,
	id: string,
	agent: string,
	model: string,
): void {
	writeMarkdown(join(root, "teams", `${id}.md`), [
		"---",
		"schemaVersion: 2",
		`id: "${id}"`,
		`name: "${id}"`,
		'protocol: "consult"',
		"models:",
		`  navigator: "${model}"`,
		"agents:",
		'  - role: "navigator"',
		`    subagent: "${agent}"`,
		"---",
		"Team body.",
	]);
}

interface UserMessage {
	message: string;
	options?: unknown;
}

export function createFakeApi(): {
	tools: Map<string, RegisteredTool>;
	api: ExtensionAPI;
	userMessages: UserMessage[];
} {
	const tools = new Map<string, RegisteredTool>();
	const userMessages: UserMessage[] = [];
	return {
		tools,
		userMessages,
		api: {
			registerTool(tool: RegisteredTool) {
				tools.set(tool.name, tool);
			},
			sendUserMessage(message: string, options?: unknown) {
				userMessages.push({ message, options });
			},
		} as unknown as ExtensionAPI,
	};
}
