/**
 * Tests for visible pi-llm-council default configuration.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import councilExtension from "../extensions/pi-llm-council/index.js";
import { resolveCouncilSettings } from "../extensions/pi-llm-council/settings.js";
import type { ToolResult } from "../lib/tool-result.js";

interface VisibleConfig {
	defaultCouncil: {
		name: string;
		purpose: string;
		members: string[];
		chairman: string;
	};
	chairmanCandidates: string[];
	defaultPair: {
		name: string;
		navigator: string;
		purpose: string;
	};
	promptDirectory: string;
	subagentDirectory: string;
	prompts?: unknown;
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

const EXTENSION_DIR = join(process.cwd(), "extensions", "pi-llm-council");
const CONFIG_DIR = join(EXTENSION_DIR, "config");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const SUBAGENTS_DIR = join(CONFIG_DIR, "subagents");
const NO_SETTINGS = "/nonexistent/path/settings.json";

function readVisibleConfig(): VisibleConfig {
	return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as VisibleConfig;
}

function readMarkdownPrompt(
	dir: string,
	fileName: string,
): { id: string; lines: string[] } {
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

function withTempSettings(settings: object, fn: (path: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "council-config-"));
	const file = join(dir, "settings.json");
	try {
		writeFileSync(file, JSON.stringify(settings), "utf8");
		fn(file);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
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
			/* no-op */
		},
		registerShortcut(_key: string, _opts: unknown) {
			/* no-op */
		},
		registerFlag(_name: string, _opts: unknown) {
			/* no-op */
		},
		on(event: string, handler: RegisteredHandler) {
			handlers.set(event, handler);
		},
		getFlag(_name: string) {
			return undefined;
		},
		sendUserMessage(_message: string, _options?: unknown) {
			/* no-op */
		},
	};
	return { api: api as unknown as ExtensionAPI, tools, handlers };
}

function contextFor(models: string[]): ExtensionContext {
	return {
		cwd: process.cwd(),
		ui: {
			setStatus: () => {
				/* no-op */
			},
			setWidget: () => {
				/* no-op */
			},
			notify: () => {
				/* no-op */
			},
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

describe("visible council config", () => {
	it("loads default council, chairman, pair, and markdown prompts from visible config", () => {
		const visible = readVisibleConfig();
		const generationPrompt = readMarkdownPrompt(
			SUBAGENTS_DIR,
			"council-generation-member.md",
		);
		const navigatorBriefPrompt = readMarkdownPrompt(
			SUBAGENTS_DIR,
			"pair-navigator-brief.md",
		);
		const resolved = resolveCouncilSettings(NO_SETTINGS, CONFIG_PATH);

		expect(resolved.defaultCouncil).toMatchObject(visible.defaultCouncil);
		expect(resolved.defaultMembers).toEqual(visible.defaultCouncil.members);
		expect(resolved.defaultChairman).toBe(visible.defaultCouncil.chairman);
		expect(resolved.chairmanCandidates).toEqual(visible.chairmanCandidates);
		expect(resolved.defaultPair).toMatchObject(visible.defaultPair);
		expect(resolved.pairs[visible.defaultPair.name]).toMatchObject({
			navigator: visible.defaultPair.navigator,
			purpose: visible.defaultPair.purpose,
		});

		expect(visible.prompts).toBeUndefined();
		expect(visible.promptDirectory).toBe("prompts");
		expect(visible.subagentDirectory).toBe("subagents");
		expect(generationPrompt.id).toBe("councilGenerationSystem");
		expect(navigatorBriefPrompt.id).toBe("pairNavigatorBriefSystem");
		expect(resolved.prompts.councilGenerationSystem).toEqual(
			generationPrompt.lines,
		);
		expect(resolved.prompts.pairNavigatorBriefSystem).toEqual(
			navigatorBriefPrompt.lines,
		);
		expect(resolved.prompts.pairNavigatorBriefTemplate).toContain("");
		expect(resolved.prompts.agentRequestTemplate).toContain("{{replyTag}}");
	});

	it("merges user prompt overrides field-by-field", () => {
		const critiqueSystemPrompt = readMarkdownPrompt(
			SUBAGENTS_DIR,
			"council-critic.md",
		);
		withTempSettings(
			{
				council: {
					prompts: {
						councilGenerationSystem: ["Custom generation system prompt."],
						pairPrimer: ["Pair {{pairName}} uses {{navigator}}.{{taskLine}}"],
					},
				},
			},
			(file) => {
				const resolved = resolveCouncilSettings(file, CONFIG_PATH);
				expect(resolved.prompts.councilGenerationSystem).toEqual([
					"Custom generation system prompt.",
				]);
				expect(resolved.prompts.pairPrimer).toEqual([
					"Pair {{pairName}} uses {{navigator}}.{{taskLine}}",
				]);
				expect(resolved.prompts.councilCritiqueSystem).toEqual(
					critiqueSystemPrompt.lines,
				);
			},
		);
	});

	it("exposes configured workflows as teams without session bootstrap", async () => {
		const fake = createFakeApi();
		councilExtension(fake.api);
		const teamList = fake.tools.get("team_list");
		if (!teamList) throw new Error("team_list not registered");
		const result = await teamList.execute(
			"test",
			{},
			undefined,
			undefined,
			contextFor(readVisibleConfig().defaultCouncil.members),
		);

		expect(result.content[0]?.text).toContain("default-council");
		expect(result.content[0]?.text).toContain("pair-consult");
		expect(result.content[0]?.text).toContain("pair-coding");
	});
});
