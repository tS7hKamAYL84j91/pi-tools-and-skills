/**
 * Tests for declarative council team specs.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CouncilStateManager } from "../extensions/pi-llm-council/state.js";
import { registerTeamRunTool } from "../extensions/pi-llm-council/team-runtime.js";
import { resolveCouncilSettings } from "../extensions/pi-llm-council/settings.js";
import {
	ensureUserTeamDefaults,
	loadTeamRegistry,
	registerTeamTools,
	requireBuiltinTeam,
	teamToCouncilDefinition,
	teamToPairDefinition,
	type TeamSpec,
} from "../extensions/pi-llm-council/teams.js";
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
		params: { id?: string; prompt?: string; scope?: "user" | "project" },
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
		const registry = loadTeamRegistry(CONFIG_PATH, { userRoot: NO_SETTINGS });

		expect([...registry.teams.keys()].sort()).toEqual([
			"default-council",
			"pair-coding",
			"pair-consult",
		]);
		expect(registry.warnings).toEqual([]);
		const defaultCouncil = requireTeam(registry, "default-council");
		expect(defaultCouncil).toMatchObject({
			topology: "council",
			protocol: "debate",
			chair: "council_chairman",
		});
		expect(defaultCouncil.agentBindings.filter((binding) => binding.role === "member")).toHaveLength(4);
		expect(defaultCouncil.agentBindings.filter((binding) => binding.subagent === "council_generation_member")).toHaveLength(4);
		expect(requireTeam(registry, "pair-consult").agents).toEqual([
			"pair_navigator_consult",
		]);
		expect(requireTeam(registry, "pair-coding").limits.maxFixPasses).toBe(1);
		expect(requireTeam(registry, "pair-coding").models).toMatchObject({
			driver: "openai-codex/gpt-5.5",
			navigator: "ollama/glm-5.1:cloud",
		});
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

	it("accepts telephone chain teams", () => {
		withTempConfig((configPath, root) => {
			writeSubagent(root, "telephone_relay_1");
			writeSubagent(root, "telephone_relay_2");
			writeFileSync(
				join(root, "teams", "telephone-game.md"),
				[
					"---",
					"schemaVersion: 1",
					'id: "telephone-game"',
					'name: "Telephone Game"',
					'topology: "chain"',
					'protocol: "telephone"',
					"agents:",
					'  - "telephone_relay_1"',
					'  - "telephone_relay_2"',
					"---",
					"Team body.",
				].join("\n"),
				"utf8",
			);

			const registry = loadTeamRegistry(configPath, { userRoot: NO_SETTINGS });

			expect(registry.warnings).toEqual([]);
			expect(registry.teams.get("telephone-game")).toMatchObject({
				topology: "chain",
				protocol: "telephone",
			});
		});
	});

	it("derives role model bindings from object agent entries", () => {
		withTempConfig((configPath, root) => {
			writeSubagent(root, "shared_member");
			writeSubagent(root, "chair_agent");
			writeFileSync(
				join(root, "teams", "object-council.md"),
				[
					"---",
					"schemaVersion: 1",
					'id: "object-council"',
					'name: "Object Council"',
					'topology: "council"',
					'protocol: "debate"',
					"agents:",
					'  - role: "member"',
					'    subagent: "shared_member"',
					'    model: "model/a"',
					'  - role: "member"',
					'    subagent: "shared_member"',
					'    model: "model/b"',
					'  - role: "chairman"',
					'    subagent: "chair_agent"',
					'    model: "model/chair"',
					"---",
					"Team body.",
				].join("\n"),
				"utf8",
			);

			const team = requireTeam(loadTeamRegistry(configPath, { userRoot: NO_SETTINGS }), "object-council");

			expect(team.agents).toEqual(["shared_member", "chair_agent"]);
			expect(team.models).toEqual({
				members: ["model/a", "model/b"],
				chairman: "model/chair",
			});
			expect(team.chair).toBe("chair_agent");
		});
	});

	it("rejects mixed object and string agent lists", () => {
		withTempConfig((configPath, root) => {
			writeSubagent(root, "known_agent");
			writeFileSync(
				join(root, "teams", "mixed-agents.md"),
				[
					"---",
					"schemaVersion: 1",
					'id: "mixed-agents"',
					'name: "Mixed Agents"',
					'topology: "pair"',
					'protocol: "consult"',
					"agents:",
					'  - role: "navigator"',
					'    subagent: "known_agent"',
					'  - "known_agent"',
					"---",
					"Team body.",
				].join("\n"),
				"utf8",
			);

			const registry = loadTeamRegistry(configPath, { userRoot: NO_SETTINGS });

			expect(registry.teams.has("mixed-agents")).toBe(false);
			expect(registry.warnings).toContain("mixed-agents: agents list must not mix object and string entries");
		});
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

	it("loads user and project teams after built-ins", () => {
		withTempConfig((configPath, root) => {
			const userRoot = join(root, "user");
			const project = join(root, "project");
			mkdirSync(join(userRoot, "subagents"), { recursive: true });
			mkdirSync(join(userRoot, "teams"), { recursive: true });
			mkdirSync(join(project, ".pi", "subagents"), { recursive: true });
			mkdirSync(join(project, ".pi", "teams"), { recursive: true });
			writeFileSync(join(project, "package.json"), "{}", "utf8");
			writeSubagent(userRoot, "user_agent");
			writeTeam(userRoot, "user-team", "user_agent");
			writeSubagent(join(project, ".pi"), "project_agent");
			writeTeam(join(project, ".pi"), "pair-consult", "project_agent");

			const registry = loadTeamRegistry(configPath, { userRoot, cwd: project });

			expect(registry.teams.get("user-team")?.source).toBe("user");
			expect(registry.teams.get("pair-consult")?.source).toBe("project");
			expect(registry.teams.get("pair-consult")?.agents).toEqual([
				"project_agent",
			]);
		});
	});

	it("instantiates built-in teams into the user directory without overwriting edits", () => {
		withTempConfig((configPath, root) => {
			const userRoot = join(root, "user");
			writeSubagent(root, "builtin_agent");
			writeTeam(root, "builtin-team", "builtin_agent");

			ensureUserTeamDefaults(userRoot, configPath);
			const teamPath = join(userRoot, "teams", "builtin-team.md");
			writeFileSync(teamPath, "custom", "utf8");
			ensureUserTeamDefaults(userRoot, configPath);

			expect(existsSync(teamPath)).toBe(true);
			expect(existsSync(join(userRoot, "subagents", "builtin_agent.md"))).toBe(true);
			expect(readFileSync(teamPath, "utf8")).toBe("custom");
		});
	});
});

describe("team adapters", () => {
	it("projects default council team to the current default council definition", () => {
		const registry = loadTeamRegistry(CONFIG_PATH, { userRoot: NO_SETTINGS });
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
		const registry = loadTeamRegistry(CONFIG_PATH, { userRoot: NO_SETTINGS });
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
		const result = await list.execute(
			"test",
			{},
			undefined,
			undefined,
			{ cwd: process.cwd() },
		);

		expect(result.content[0]?.text).toContain("default-council");
		expect(result.details.teams).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "pair-consult", topology: "pair" }),
			]),
		);
	});

	it("team_describe includes model bindings", async () => {
		const { api, tools } = createFakeApi();
		registerTeamTools(api);
		const describeTeam = tools.get("team_describe");
		if (!describeTeam) throw new Error("team_describe missing");

		const result = await describeTeam.execute(
			"test",
			{ id: "pair-consult" },
			undefined,
			undefined,
			{ cwd: process.cwd() },
		);

		expect(result.content[0]?.text).toContain("Navigator model:");
	});

	it("team_delete removes project teams", async () => {
		const root = mkdtempSync(join(tmpdir(), "team-delete-"));
		try {
			const project = join(root, "project");
			mkdirSync(join(project, ".pi", "subagents"), { recursive: true });
			mkdirSync(join(project, ".pi", "teams"), { recursive: true });
			writeFileSync(join(project, "package.json"), "{}", "utf8");
			writeSubagent(join(project, ".pi"), "delete_agent");
			writeTeam(join(project, ".pi"), "delete-me", "delete_agent");
			const teamPath = join(project, ".pi", "teams", "delete-me.md");
			const { api, tools } = createFakeApi();
			registerTeamRunTool(api, { stateManager: new CouncilStateManager() });
			const remove = tools.get("team_delete");
			if (!remove) throw new Error("team_delete missing");

			const result = await remove.execute(
				"test",
				{ id: "delete-me" },
				undefined,
				undefined,
				{ cwd: project },
			);

			expect(result.content[0]?.text).toContain("deleted");
			expect(existsSync(teamPath)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("team_delete protects built-in ids unless scoped", async () => {
		const { api, tools } = createFakeApi();
		registerTeamRunTool(api, { stateManager: new CouncilStateManager() });
		const remove = tools.get("team_delete");
		if (!remove) throw new Error("team_delete missing");

		await expect(
			remove.execute(
				"test",
				{ id: "default-council" },
				undefined,
				undefined,
				{ cwd: process.cwd() },
			),
		).rejects.toThrow(/built-in default id/);
	});

	it("team_delete removes project overrides and reveals built-ins", async () => {
		const root = mkdtempSync(join(tmpdir(), "team-delete-override-"));
		try {
			const project = join(root, "project");
			mkdirSync(join(project, ".pi", "subagents"), { recursive: true });
			mkdirSync(join(project, ".pi", "teams"), { recursive: true });
			writeFileSync(join(project, "package.json"), "{}", "utf8");
			writeSubagent(join(project, ".pi"), "project_agent");
			writeTeam(join(project, ".pi"), "pair-consult", "project_agent");
			const { api, tools } = createFakeApi();
			registerTeamRunTool(api, { stateManager: new CouncilStateManager() });
			const remove = tools.get("team_delete");
			if (!remove) throw new Error("team_delete missing");

			await remove.execute(
				"test",
				{ id: "pair-consult", scope: "project" },
				undefined,
				undefined,
				{ cwd: project },
			);

			const registry = loadTeamRegistry(CONFIG_PATH, { userRoot: NO_SETTINGS, cwd: project });
			expect(registry.teams.get("pair-consult")?.source).toBe("builtin");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("team_delete rejects unknown team ids", async () => {
		const { api, tools } = createFakeApi();
		registerTeamRunTool(api, { stateManager: new CouncilStateManager() });
		const remove = tools.get("team_delete");
		if (!remove) throw new Error("team_delete missing");

		await expect(
			remove.execute(
				"test",
				{ id: "missing-team" },
				undefined,
				undefined,
				{ cwd: process.cwd() },
			),
		).rejects.toThrow(/No team "missing-team"/);
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
				{ cwd: process.cwd(), ui: { setStatus: () => undefined } },
			),
		).rejects.toThrow(/No team "missing".*default-council.*pair-coding.*pair-consult/s);
	});
});
