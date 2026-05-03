/**
 * Tests for visible pi-teams default team-root configuration.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import teamExtension from "../extensions/pi-teams/index.js";
import { resolveTeamSettings } from "../extensions/pi-teams/settings.js";
import type { ToolResult } from "../lib/tool-result.js";

interface VisibleConfig {
	schemaVersion: number;
	layout: string;
}

interface RegisteredTool {
	name: string;
	execute: (
		id: string,
		params: Record<string, never>,
		signal?: AbortSignal,
		onUpdate?: unknown,
		ctx?: ExtensionContext,
	) => Promise<ToolResult>;
}

type RegisteredHandler = (
	event: Record<string, unknown>,
	ctx: ExtensionContext,
) => Promise<unknown> | unknown;

const CONFIG_DIR = join(process.cwd(), "extensions", "pi-teams", "config");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const AGENTS_DIR = join(CONFIG_DIR, "agents");
const NO_SETTINGS = "/nonexistent/path/settings.json";

function readVisibleConfig(): VisibleConfig {
	return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as VisibleConfig;
}

function readMarkdownPrompt(dir: string, fileName: string): { id: string; lines: string[] } {
	const raw = readFileSync(join(dir, fileName), "utf8").replace(/\r\n/g, "\n");
	const end = raw.indexOf("\n---\n", 4);
	const frontMatter = raw.slice(4, end);
	const id =
		/^promptId:\s*(.+)$/m.exec(frontMatter)?.[1]?.trim() ??
		/^id:\s*(.+)$/m.exec(frontMatter)?.[1]?.trim() ??
		"";
	const body = raw.slice(end + "\n---\n".length).replace(/\n$/, "");
	return { id: id.replace(/^['"]|['"]$/g, ""), lines: body.split("\n") };
}

function createFakeApi(): {
	api: ExtensionAPI;
	tools: Map<string, RegisteredTool>;
	handlers: Map<string, RegisteredHandler>;
} {
	const tools = new Map<string, RegisteredTool>();
	const handlers = new Map<string, RegisteredHandler>();
	const api = {
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
		},
		registerCommand(_name: string, _definition: unknown) {
			// no-op
		},
		on(event: string, handler: RegisteredHandler) {
			handlers.set(event, handler);
		},
		appendEntry(_customType: string, _data?: unknown) {
			// no-op
		},
	};
	return { api: api as unknown as ExtensionAPI, tools, handlers };
}

function contextFor(models: string[]): ExtensionContext {
	return {
		cwd: process.cwd(),
		ui: {
			setStatus: () => undefined,
			setWidget: () => undefined,
			notify: () => undefined,
		},
		modelRegistry: {
			getAvailable: () =>
				models.map((model) => {
					const slash = model.indexOf("/");
					return {
						provider: model.slice(0, slash),
						id: model.slice(slash + 1),
					};
				}),
		},
	} as unknown as ExtensionContext;
}

describe("visible team config", () => {
	it("uses a minimal team-root config and loads defaults from team files", () => {
		const visible = readVisibleConfig();
		const generationPrompt = readMarkdownPrompt(AGENTS_DIR, "debate-generation-member.md");
		const navigatorBriefPrompt = readMarkdownPrompt(AGENTS_DIR, "pair-coding-navigator-brief.md");
		const resolved = resolveTeamSettings(NO_SETTINGS, CONFIG_PATH);

		expect(visible).toEqual({ schemaVersion: 1, layout: "teams-root" });
		expect(resolved.defaultMembers).toEqual([
			"openai-codex/gpt-5.5",
			"google-gemini-cli/gemini-3.1-pro-preview",
			"ollama/qwen3.5:cloud",
			"ollama/glm-5.1:cloud",
		]);
		expect(resolved.defaultSynthesis).toBe("openai-codex/gpt-5.5");
		expect(resolved.defaultConsult?.navigator).toBe("ollama/qwen3.5:cloud");
		expect(generationPrompt.id).toBe("debate/generation/system");
		expect(navigatorBriefPrompt.id).toBe("pair-coding/navigator-brief/system");
		expect(resolved.prompts["debate/generation/system"]).toEqual(generationPrompt.lines);
		expect(resolved.prompts["pair-coding/navigator-brief/system"]).toEqual(navigatorBriefPrompt.lines);
		expect(resolved.prompts["pair-coding/navigator-brief/template"]).toContain("");
	});

	it("exposes configured workflows as teams without session bootstrap", async () => {
		const fake = createFakeApi();
		teamExtension(fake.api);
		const teamList = fake.tools.get("team_list");
		if (!teamList) throw new Error("team_list not registered");
		const settings = resolveTeamSettings(NO_SETTINGS, CONFIG_PATH);
		const result = await teamList.execute(
			"test",
			{},
			undefined,
			undefined,
			contextFor(settings.defaultMembers),
		);

		expect(result.content[0]?.text).toContain("default-debate");
		expect(result.content[0]?.text).toContain("consult");
		expect(result.content[0]?.text).toContain("pair-coding");
	});
});
