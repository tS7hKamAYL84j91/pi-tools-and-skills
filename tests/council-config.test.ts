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
	prompts: Record<string, string[]>;
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

const CONFIG_PATH = join(
	process.cwd(),
	"extensions",
	"pi-llm-council",
	"config.json",
);
const NO_SETTINGS = "/nonexistent/path/settings.json";

function readVisibleConfig(): VisibleConfig {
	return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as VisibleConfig;
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
	it("loads default council, chairman, pair, and prompts from extension config.json", () => {
		const visible = readVisibleConfig();
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

		expect(resolved.prompts.councilGenerationSystem).toEqual(
			visible.prompts.councilGenerationSystem,
		);
		expect(resolved.prompts.pairNavigatorBriefSystem).toEqual(
			visible.prompts.pairNavigatorBriefSystem,
		);
		expect(resolved.prompts.pairNavigatorBriefTemplate).toContain("");
		expect(resolved.prompts.agentRequestTemplate).toContain("{{replyTag}}");
	});

	it("merges user prompt overrides field-by-field", () => {
		const visible = readVisibleConfig();
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
					visible.prompts.councilCritiqueSystem,
				);
			},
		);
	});

	it("forms the configured default pair on session_start", async () => {
		const visible = readVisibleConfig();
		const fake = createFakeApi();
		councilExtension(fake.api);
		const handler = fake.handlers.get("session_start");
		if (!handler) throw new Error("session_start not registered");

		await handler({}, contextFor(visible.defaultCouncil.members));
		const pairList = fake.tools.get("pair_list");
		if (!pairList) throw new Error("pair_list not registered");
		const result = await pairList.execute(
			"test",
			{},
			undefined,
			undefined,
			contextFor(visible.defaultCouncil.members),
		);

		expect(result.content[0]?.text).toContain(visible.defaultPair.name);
		expect(result.content[0]?.text).toContain(visible.defaultPair.navigator);
	});
});
