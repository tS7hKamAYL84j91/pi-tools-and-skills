/**
 * Tests for declarative council team specs.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CouncilStateManager } from "../extensions/pi-llm-council/state.js";
import { registerTeamRunTool } from "../extensions/pi-llm-council/team-runtime.js";
import {
	loadTeamRegistry,
	registerTeamTools,
	requireBuiltinTeam,
	teamToCouncilDefinition,
	teamToPairDefinition,
	type TeamSpec,
} from "../extensions/pi-llm-council/teams.js";
import { resolveCouncilSettings } from "../extensions/pi-llm-council/settings.js";
import type { ToolResult } from "../lib/tool-result.js";

const CONFIG_PATH = join(
	process.cwd(),
	"extensions",
	"pi-llm-council",
	"config",
	"config.json",
);
const NO_SETTINGS = "/nonexistent/path/settings.json";

interface RegisteredTool {
	name: string;
	execute: (
		id: string,
		params: { id?: string; prompt?: string },
		signal?: AbortSignal,
		onUpdate?: unknown,
		ctx?: unknown,
	) => Promise<ToolResult>;
}

function withTempConfig(fn: (configPath: string, root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "council-teams-"));
	try {
		mkdirSync(join(root, "subagents"));
		mkdirSync(join(root, "teams"));
		const configPath = join(root, "config.json");
		writeFileSync(
			configPath,
			JSON.stringify({ subagentDirectory: "subagents", teamDirectory: "teams" }),
			"utf8",
		);
		fn(configPath, root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeSubagent(root: string, name: string): void {
	writeFileSync(
		join(root, "subagents", `${name}.md`),
		[
			"---",
			`name: "${name}"`,
			`promptId: "${name}System"`,
			"---",
			"Subagent body.",
		].join("\n"),
		"utf8",
	);
}

function writeTeam(root: string, id: string, agent: string): void {
	writeFileSync(
		join(root, "teams", `${id}.md`),
		[
			"---",
			"schemaVersion: 1",
			`id: "${id}"`,
			`name: "${id}"`,
			'topology: "pair"',
			'protocol: "consult"',
			"agents:",
			`  - "${agent}"`,
			"---",
			"Team body.",
		].join("\n"),
		"utf8",
	);
}

function createFakeApi(): { tools: Map<string, RegisteredTool>; api: ExtensionAPI } {
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

function requireTeam(registry: ReturnType<typeof loadTeamRegistry>, id: string): TeamSpec {
	const team = registry.teams.get(id);
	if (!team) throw new Error(`Missing team ${id}`);
	return team;
}

describe("loadTeamRegistry", () => {
	it("loads built-in teams and validates subagent references", () => {
		const registry = loadTeamRegistry(CONFIG_PATH);

		expect([...registry.teams.keys()].sort()).toEqual([
			"default-council",
			"pair-coding",
			"pair-consult",
		]);
		expect(registry.warnings).toEqual([]);
		expect(requireTeam(registry, "default-council")).toMatchObject({
			topology: "council",
			protocol: "debate",
			chair: "council_chairman",
		});
		expect(requireTeam(registry, "pair-consult").agents).toEqual([
			"pair_navigator_consult",
		]);
		expect(requireTeam(registry, "pair-coding").limits.maxFixPasses).toBe(1);
	});

	it("requires built-in teams by topology and protocol", () => {
		const team = requireBuiltinTeam("pair-coding", {
			topology: "pair",
			protocol: "pair-coding",
		});

		expect(team.id).toBe("pair-coding");
		expect(() =>
			requireBuiltinTeam("pair-coding", {
				topology: "pair",
				protocol: "consult",
			}),
		).toThrow(/must be pair\/consult/);
	});

	it("reports unknown subagent references", () => {
		withTempConfig((configPath, root) => {
			writeSubagent(root, "known_agent");
			writeTeam(root, "broken", "missing_agent");

			const registry = loadTeamRegistry(configPath);

			expect(registry.teams.has("broken")).toBe(true);
			expect(registry.warnings).toContain("broken: unknown agent missing_agent");
		});
	});
});

describe("team adapters", () => {
	it("projects default council team to the current default council definition", () => {
		const registry = loadTeamRegistry(CONFIG_PATH);
		const settings = resolveCouncilSettings(NO_SETTINGS, CONFIG_PATH);
		const team = requireTeam(registry, "default-council");
		const definition = teamToCouncilDefinition({
			team,
			settings,
			snapshot: settings.defaultMembers,
		});

		expect(definition).toMatchObject({
			name: settings.defaultCouncil.name,
			purpose: settings.defaultCouncil.purpose,
			members: settings.defaultMembers,
			chairman: settings.defaultChairman,
		});
	});

	it("projects pair teams to the current default pair definition", () => {
		const registry = loadTeamRegistry(CONFIG_PATH);
		const settings = resolveCouncilSettings(NO_SETTINGS, CONFIG_PATH);
		const team = requireTeam(registry, "pair-consult");
		const definition = teamToPairDefinition({ team, settings });

		expect(definition).toMatchObject({
			name: settings.defaultPair?.name,
			navigator: settings.defaultPair?.navigator,
			purpose: settings.defaultPair?.purpose,
		});
	});
});

describe("team tools", () => {
	it("registers read-only team discovery tools", async () => {
		const { api, tools } = createFakeApi();
		registerTeamTools(api);

		expect([...tools.keys()].sort()).toEqual(["team_describe", "team_list"]);
		const list = tools.get("team_list");
		if (!list) throw new Error("team_list missing");
		const result = await list.execute("test", {});

		expect(result.content[0]?.text).toContain("default-council");
		expect(result.details.teams).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "pair-consult", topology: "pair" }),
			]),
		);
	});

	it("team_run rejects unknown team ids with a clear list", async () => {
		const { api, tools } = createFakeApi();
		registerTeamRunTool(api, { stateManager: new CouncilStateManager() });
		const run = tools.get("team_run");
		if (!run) throw new Error("team_run missing");

		await expect(
			run.execute(
				"test",
				{ id: "missing", prompt: "hello" },
				undefined,
				undefined,
				{ ui: { setStatus: () => undefined } },
			),
		).rejects.toThrow(/No team "missing".*default-council.*pair-coding.*pair-consult/s);
	});
});
