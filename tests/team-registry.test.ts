/**
 * Tests for declarative team specs.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TeamStateManager } from "../extensions/pi-teams/state.js";
import { createTeamFiles, deleteTeamFiles, updateTeamModels } from "../extensions/pi-teams/team-form.js";
import { registerTeamRunTool } from "../extensions/pi-teams/team-runtime.js";
import { validateTeamManifest } from "../extensions/pi-teams/team-manifest.js";
import { modelSlotsForTeam } from "../extensions/pi-teams/team-handlers.js";
import { loadTeamRegistry, requireBuiltinTeam } from "../extensions/pi-teams/team-registry.js";
import { registerTeamTools } from "../extensions/pi-teams/team-tools.js";
import type { TeamSpec } from "../extensions/pi-teams/team-types.js";
import type { ToolResult } from "../lib/tool-result.js";

const CONFIG_PATH = join(
	process.cwd(),
	"extensions",
	"pi-teams",
	"config",
	"config.json",
);
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
	const root = mkdtempSync(join(tmpdir(), "team-registry-"));
	try {
		mkdirSync(join(root, "agents"));
		mkdirSync(join(root, "teams"));
		const configPath = join(root, "config.json");
		writeFileSync(
			configPath,
			JSON.stringify({ layout: "teams-root" }),
			"utf8",
		);
		fn(configPath, root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeSubagent(root: string, name: string): void {
	writeFileSync(
		join(root, "agents", `${name}.md`),
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
		const registry = loadTeamRegistry(CONFIG_PATH, { roots: [] });

		expect([...registry.teams.keys()].sort()).toEqual([
			"consult",
			"default-debate",
			"pair-coding",
		]);
		expect(registry.warnings).toEqual([]);
		const defaultDebate = requireTeam(registry, "default-debate");
		expect(defaultDebate).toMatchObject({
			protocol: "debate",
		});
		expect(defaultDebate.agentBindings.filter((binding) => binding.role === "member")).toHaveLength(4);
		expect(defaultDebate.agentBindings.filter((binding) => binding.subagent === "debate_generation_member")).toHaveLength(4);
		expect(requireTeam(registry, "consult").agents).toEqual([
			"consult_navigator",
		]);
		expect(requireTeam(registry, "pair-coding").limits.maxFixPasses).toBe(1);
		expect(requireTeam(registry, "pair-coding").models).toMatchObject({
			driver: "openai-codex/gpt-5.5",
			navigator: "ollama/glm-5.1:cloud",
		});
	});

	it("requires built-in teams by protocol", () => {
		const team = requireBuiltinTeam("pair-coding", {
			protocol: "pair-coding",
		});

		expect(team.id).toBe("pair-coding");
		expect(() =>
			requireBuiltinTeam("pair-coding", {
				protocol: "consult",
			}),
		).toThrow(/must use protocol consult/);
	});

	it("accepts telephone chain teams", () => {
		withTempConfig((configPath, root) => {
			writeSubagent(root, "telephone_relay_1");
			writeSubagent(root, "telephone_relay_2");
			writeFileSync(
				join(root, "teams", "telephone-game.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "telephone-game"',
					'name: "Telephone Game"',
										'protocol: "telephone"',
					"agents:",
					'  - role: "relay_1"',
					'    subagent: "telephone_relay_1"',
					'  - role: "relay_2"',
					'    subagent: "telephone_relay_2"',
					"---",
					"Team body.",
				].join("\n"),
				"utf8",
			);

			const registry = loadTeamRegistry(configPath, { roots: [] });

			expect(registry.warnings).toEqual([]);
			expect(registry.teams.get("telephone-game")).toMatchObject({
				protocol: "telephone",
			});
		});
	});

	it("derives subagent execution config from protocol and manifests", () => {
		withTempConfig((configPath, root) => {
			writeFileSync(
				join(root, "agents", "navigator_agent.md"),
				[
					"---",
					'name: "navigator_agent"',
					"tools: []",
					"parameters:",
					"  temperature: 0.9",
					"---",
					"Navigator system prompt.",
				].join("\n"),
				"utf8",
			);
			writeFileSync(
				join(root, "teams", "protocol-only.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "protocol-only"',
					'name: "Protocol Only"',
					'protocol: "consult"',
					"agents:",
					'  - role: "navigator"',
					'    subagent: "navigator_agent"',
					"---",
					"Team body.",
				].join("\n"),
				"utf8",
			);

			const team = requireTeam(loadTeamRegistry(configPath, { roots: [] }), "protocol-only");

			expect(team.agentBindings[0]).toMatchObject({
				tools: [],
				parameters: { temperature: 0.9 },
				subagentSystemPrompt: "Navigator system prompt.",
			});
		});
	});

	it("lets binding config explicitly override subagent config with empty values", () => {
		withTempConfig((configPath, root) => {
			writeFileSync(
				join(root, "agents", "navigator_agent.md"),
				[
					"---",
					'name: "navigator_agent"',
					"tools:",
					'  - "read"',
					"parameters:",
					"  temperature: 0.9",
					"---",
					"Navigator system prompt.",
				].join("\n"),
				"utf8",
			);
			writeFileSync(
				join(root, "teams", "binding-override.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "binding-override"',
					'name: "Binding Override"',
					'protocol: "consult"',
					"agents:",
					'  - role: "navigator"',
					'    subagent: "navigator_agent"',
					"    tools: []",
					"    parameters: {}",
					"---",
					"Team body.",
				].join("\n"),
				"utf8",
			);

			const team = requireTeam(loadTeamRegistry(configPath, { roots: [] }), "binding-override");

			expect(team.agentBindings[0]).toMatchObject({
				tools: [],
				parameters: {},
			});
		});
	});

	it("loads graph protocol manifests as unsupported legacy teams and ignores graph fields", () => {
		withTempConfig((configPath, root) => {
			writeSubagent(root, "reviewer");
			writeSubagent(root, "qa");
			writeFileSync(
				join(root, "teams", "review-qa.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "review-qa"',
					'name: "Review QA"',
					'protocol: "graph"',
					"agents:",
					'  - role: "review"',
					'    subagent: "reviewer"',
					'    model: "model/review"',
					'  - role: "qa"',
					'    subagent: "qa"',
					'    model: "model/qa"',
					"edges:",
					'  - from: "review"',
					'    to: "qa"',
					"---",
					"Team body.",
				].join("\n"),
				"utf8",
			);

			const registry = loadTeamRegistry(configPath, { roots: [] });
			const team = requireTeam(registry, "review-qa");

			expect(team.protocol).toBe("graph");
			expect(registry.warnings).toContain("review-qa: legacy workflow fields are ignored; direct team protocols no longer execute generic workflows");
			expect(team.agentBindings.map((binding) => binding.role)).toEqual(["review", "qa"]);
		});
	});

	it("derives role model bindings from object agent entries", () => {
		withTempConfig((configPath, root) => {
			writeSubagent(root, "shared_member");
			writeSubagent(root, "synthesis_agent");
			writeFileSync(
				join(root, "teams", "object-debate.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "object-debate"',
					'name: "Object Debate"',
										'protocol: "debate"',
					"agents:",
					'  - role: "member"',
					'    subagent: "shared_member"',
					'    model: "model/a"',
					'  - role: "member"',
					'    subagent: "shared_member"',
					'    model: "model/b"',
					'  - role: "synthesis"',
					'    subagent: "synthesis_agent"',
					'    model: "model/synthesis"',
					"---",
					"Team body.",
				].join("\n"),
				"utf8",
			);

			const team = requireTeam(loadTeamRegistry(configPath, { roots: [] }), "object-debate");

			expect(team.agents).toEqual(["shared_member", "synthesis_agent"]);
			expect(team.models).toEqual({
				members: ["model/a", "model/b"],
				synthesis: "model/synthesis",
			});
		});
	});

	it("reports missing live-agent refs without requiring subagent ids", () => {
		withTempConfig((configPath, root) => {
			writeTeam(root, "live-consult", "agent:definitely-missing-live-peer");

			const registry = loadTeamRegistry(configPath);

			expect(registry.teams.has("live-consult")).toBe(true);
			expect(registry.warnings.some((warning) => warning.startsWith("live-consult: live agent agent:definitely-missing-live-peer is not registered"))).toBe(true);
			expect(registry.warnings.some((warning) => warning.includes("invalid agent id"))).toBe(false);
		});
	});

	it("rejects mixed object and string agent lists", () => {
		withTempConfig((configPath, root) => {
			writeSubagent(root, "known_agent");
			writeFileSync(
				join(root, "teams", "mixed-agents.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "mixed-agents"',
					'name: "Mixed Agents"',
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

			const registry = loadTeamRegistry(configPath, { roots: [] });

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
			mkdirSync(join(userRoot, "agents"), { recursive: true });
			mkdirSync(join(userRoot, "teams"), { recursive: true });
			mkdirSync(join(project, ".pi", "teams", "agents"), { recursive: true });
			mkdirSync(join(project, ".pi", "teams", "teams"), { recursive: true });
			writeFileSync(join(project, "package.json"), "{}", "utf8");
			writeFileSync(join(root, "settings.json"), JSON.stringify({ teams: { roots: [userRoot] } }), "utf8");
			writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({ teams: { roots: [".pi/teams"] } }), "utf8");
			writeSubagent(userRoot, "user_agent");
			writeTeam(userRoot, "user-team", "user_agent");
			writeSubagent(join(project, ".pi", "teams"), "project_agent");
			writeTeam(join(project, ".pi", "teams"), "consult", "project_agent");

			const registry = loadTeamRegistry(configPath, { settingsPath: join(root, "settings.json"), cwd: project });

			expect(registry.teams.get("user-team")?.source).toBe("user");
			expect(registry.teams.get("consult")?.source).toBe("project");
			expect(registry.teams.get("consult")?.agents).toEqual([
				"project_agent",
			]);
		});
	});

	it("team_form creates runnable debate bindings without member models", () => {
		const project = mkdtempSync(join(tmpdir(), "team-form-debate-"));
		try {
			writeFileSync(join(project, "package.json"), "{}", "utf8");

			const result = createTeamFiles({
				id: "review-debate",
				protocol: "debate",
				agents: ["review_member", "review_critic"],
				scope: "project",
			}, project);
			const body = readFileSync(result.teamPath, "utf8");

			expect(body).toContain('role: "member"');
			expect(body).toContain('subagent: "review_member"');
			expect(body).toContain('role: "synthesis"');
			expect(body).toContain('role: "critic"');
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});

	it("team_form preserves live-agent refs without creating subagent stubs", () => {
		const project = mkdtempSync(join(tmpdir(), "team-form-live-"));
		try {
			writeFileSync(join(project, "package.json"), "{}", "utf8");

			const result = createTeamFiles({
				id: "live-review",
				protocol: "consult",
				agents: ["agent:reviewer"],
				scope: "project",
			}, project);
			const body = readFileSync(result.teamPath, "utf8");

			expect(body).toContain('subagent: "agent:reviewer"');
			expect(result.subagentPaths).toEqual([]);
			expect(existsSync(join(project, ".pi", "teams", "agents", "agent:reviewer.md"))).toBe(false);
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});

	it("team_delete removes unreferenced generated subagent stubs", () => {
		const project = mkdtempSync(join(tmpdir(), "team-delete-generated-"));
		try {
			writeFileSync(join(project, "package.json"), "{}", "utf8");
			mkdirSync(join(project, ".pi"), { recursive: true });
			writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({ teams: { roots: [".pi/teams"] } }), "utf8");
			const result = createTeamFiles({ id: "generated-review", protocol: "consult", agents: ["generated_navigator"], scope: "project" }, project);
			const subagentPath = join(project, ".pi", "teams", "agents", "generated_navigator.md");

			expect(result.subagentPaths).toEqual([subagentPath]);
			expect(readFileSync(subagentPath, "utf8")).toContain('generatedBy: "pi-teams"');

			deleteTeamFiles({ id: "generated-review", scope: "project" }, project);

			expect(existsSync(result.teamPath)).toBe(false);
			expect(existsSync(subagentPath)).toBe(false);
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});

	it("team_models preserves binding config while dropping legacy graph policy", () => {
		const project = mkdtempSync(join(tmpdir(), "team-models-graph-"));
		try {
			const teamsRoot = join(project, ".pi", "teams");
			mkdirSync(join(teamsRoot, "agents"), { recursive: true });
			mkdirSync(join(teamsRoot, "teams"), { recursive: true });
			mkdirSync(join(project, ".pi"), { recursive: true });
			writeFileSync(join(project, "package.json"), "{}", "utf8");
			writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({ teams: { roots: [".pi/teams"] } }), "utf8");
			writeSubagent(teamsRoot, "reviewer");
			writeSubagent(teamsRoot, "qa");
			writeFileSync(
				join(teamsRoot, "teams", "review-qa.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "review-qa"',
					'name: "Review QA"',
					'protocol: "graph"',
					"prompts:",
					'  node.template: "custom-node-template"',
					"agents:",
					'  - role: "review"',
					'    subagent: "reviewer"',
					'    model: "old/review"',
					'    promptId: "review/system"',
					'    templateId: "review/template"',
					"    maxRetries: 2",
					'    tools: ["read"]',
					'    parameters: { "temperature": 0.2, "maxTokens": 42 }',
					'  - role: "qa"',
					'    subagent: "qa"',
					'    model: "old/qa"',
					"edges:",
					'  - from: "review"',
					'    to: "qa"',
					'outputs: ["qa"]',
					'reducer: "concat"',
					"maxConcurrency: 1",
					"maxRetries: 3",
					"---",
					"Team body.",
				].join("\n"),
				"utf8",
			);

			updateTeamModels({ id: "review-qa", models: { members: ["new/review", "new/qa"] } }, project);
			const updated = readFileSync(join(teamsRoot, "teams", "review-qa.md"), "utf8");
			const team = requireTeam(loadTeamRegistry(CONFIG_PATH, { cwd: project }), "review-qa");

			expect(updated).toContain('node.template: "custom-node-template"');
			expect(updated).toContain('tools: ["read"]');
			expect(updated).toContain('parameters: { "temperature": 0.2, "maxTokens": 42 }');
			expect(updated).not.toContain('outputs: ["qa"]');
			expect(updated).not.toContain('reducer: "concat"');
			expect(updated).toContain("maxConcurrency: 1");
			expect(updated).toContain("maxRetries: 3");
			expect(team.models.members).toBeUndefined();
			expect(team.prompts["node.template"]).toBe("custom-node-template");
			expect(team.limits.maxConcurrency).toBe(1);
			expect(team.limits.maxRetries).toBe(3);
			expect(team.agentBindings[0]).toMatchObject({
				model: "old/review",
				promptId: "review/system",
				templateId: "review/template",
				maxRetries: 2,
				tools: ["read"],
				parameters: { temperature: 0.2, maxTokens: 42 },
			});
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});

	it("compiles and validates manifest-level prompt contracts and model slots", () => {
		withTempConfig((configPath, root) => {
			writeSubagent(root, "graph_agent");
			writeFileSync(
				join(root, "teams", "manifest-graph.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "manifest-graph"',
					'name: "Manifest Graph"',
					'protocol: "graph"',
					"promptContracts:",
					'  - id: "node.template"',
					'    kind: "template"',
					'    defaultPromptId: "graph/node/template"',
					'    roles: ["node", "member"]',
					"modelSlots:",
					'  - id: "members"',
					'    kind: "member"',
					'    count: "dynamic"',
					'    label: "Graph member"',
					"agents:",
					'  - role: "draft"',
					'    subagent: "graph_agent"',
					'    model: "test/draft"',
					'  - role: "review"',
					'    subagent: "graph_agent"',
					'    model: "test/review"',
					"edges:",
					'  - from: "draft"',
					'    to: "review"',
					'outputs: ["review"]',
					"---",
					"Manifest graph body.",
				].join("\n"),
				"utf8",
			);

			const team = requireTeam(loadTeamRegistry(configPath, { roots: [] }), "manifest-graph");

			expect(team.promptContracts).toEqual([{ id: "node.template", kind: "template", defaultPromptId: "graph/node/template", roles: ["node", "member"] }]);
			expect(validateTeamManifest(team)).toEqual({ ok: true });
			expect(modelSlotsForTeam(team, team.models)).toEqual([
				{ id: "members:0", label: "Graph member", current: undefined, kind: "member", index: 0 },
				{ id: "members:1", label: "Graph member", current: undefined, kind: "member", index: 1 },
			]);
		});
	});

	it("rejects invalid manifest metadata before execution", () => {
		withTempConfig((configPath, root) => {
			writeSubagent(root, "graph_agent");
			writeFileSync(
				join(root, "teams", "valid-graph.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "valid-graph"',
					'name: "Valid Graph"',
					'protocol: "graph"',
					"agents:",
					'  - role: "solo"',
					'    subagent: "graph_agent"',
					'    model: "test/solo"',
					"outputs: [\"solo\"]",
					"---",
					"Valid graph body.",
				].join("\n"),
				"utf8",
			);
			const team = requireTeam(loadTeamRegistry(configPath, { roots: [] }), "valid-graph");

			expect(() => validateTeamManifest({ ...team, promptContracts: [{ id: "node.template", kind: "template" }, { id: "node.template", kind: "template" }] })).toThrow('promptContracts has duplicate id "node.template".');
			expect(() => validateTeamManifest({ ...team, modelSlots: [{ id: "bad-count", kind: "member", count: 0 }] })).toThrow("modelSlots.bad-count.count must be dynamic or a positive integer.");
		});
	});

	it("reports strict manifest validator failures as registry warnings", () => {
		withTempConfig((configPath, root) => {
			writeSubagent(root, "graph_agent");
			writeFileSync(
				join(root, "teams", "bad-slots.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "bad-slots"',
					'name: "Bad Slots"',
					'protocol: "graph"',
					"modelSlots:",
					'  - id: "members"',
					'    kind: "member"',
					"agents:",
					'  - role: "solo"',
					'    subagent: "graph_agent"',
					'    model: "test/solo"',
					"outputs: [\"solo\"]",
					"---",
					"Bad slots body.",
				].join("\n"),
				"utf8",
			);
			writeFileSync(
				join(root, "teams", "duplicate-slots.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "duplicate-slots"',
					'name: "Duplicate Slots"',
					'protocol: "graph"',
					"modelSlots:",
					'  - id: "members"',
					'    kind: "member"',
					'  - id: "members"',
					'    kind: "member"',
					"agents:",
					'  - role: "solo"',
					'    subagent: "graph_agent"',
					'    model: "test/solo"',
					"outputs: [\"solo\"]",
					"---",
					"Duplicate slots body.",
				].join("\n"),
				"utf8",
			);
			writeFileSync(
				join(root, "teams", "broken-edge.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "broken-edge"',
					'name: "Broken Edge"',
					'protocol: "graph"',
					"agents:",
					'  - role: "solo"',
					'    subagent: "graph_agent"',
					'    model: "test/solo"',
					"edges:",
					'  - from: "solo"',
					'    to: "missing"',
					"outputs: [\"solo\"]",
					"---",
					"Broken edge body.",
				].join("\n"),
				"utf8",
			);
			writeFileSync(
				join(root, "teams", "future-schema.md"),
				[
					"---",
					"schemaVersion: 3",
					'id: "future-schema"',
					'name: "Future Schema"',
					'protocol: "consult"',
					"agents:",
					'  - role: "navigator"',
					'    subagent: "graph_agent"',
					"---",
					"Future schema body.",
				].join("\n"),
				"utf8",
			);

			const registry = loadTeamRegistry(configPath, { roots: [] });

			expect(registry.teams.has("bad-slots")).toBe(true);
			expect(registry.teams.has("future-schema")).toBe(false);
			expect(registry.warnings).toContain('duplicate-slots: modelSlots has duplicate id "members".');
			expect(registry.warnings).toContain("broken-edge: legacy workflow fields are ignored; direct team protocols no longer execute generic workflows");
			expect(registry.warnings).toContain("future-schema: schemaVersion 2 is required");
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

		expect(result.content[0]?.text).toContain("default-debate");
		expect(result.details.teams).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "consult", protocol: "consult" }),
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
			{ id: "consult" },
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
			mkdirSync(join(project, ".pi", "teams", "agents"), { recursive: true });
			mkdirSync(join(project, ".pi", "teams", "teams"), { recursive: true });
			writeFileSync(join(project, "package.json"), "{}", "utf8");
			writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({ teams: { roots: [".pi/teams"] } }), "utf8");
			writeSubagent(join(project, ".pi", "teams"), "delete_agent");
			writeTeam(join(project, ".pi", "teams"), "delete-me", "delete_agent");
			const teamPath = join(project, ".pi", "teams", "teams", "delete-me.md");
			const { api, tools } = createFakeApi();
			registerTeamRunTool(api, { stateManager: new TeamStateManager() });
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
		registerTeamRunTool(api, { stateManager: new TeamStateManager() });
		const remove = tools.get("team_delete");
		if (!remove) throw new Error("team_delete missing");

		await expect(
			remove.execute(
				"test",
				{ id: "default-debate" },
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
			mkdirSync(join(project, ".pi", "teams", "agents"), { recursive: true });
			mkdirSync(join(project, ".pi", "teams", "teams"), { recursive: true });
			writeFileSync(join(project, "package.json"), "{}", "utf8");
			writeSubagent(join(project, ".pi", "teams"), "project_agent");
			writeTeam(join(project, ".pi", "teams"), "consult", "project_agent");
			const { api, tools } = createFakeApi();
			registerTeamRunTool(api, { stateManager: new TeamStateManager() });
			const remove = tools.get("team_delete");
			if (!remove) throw new Error("team_delete missing");

			await remove.execute(
				"test",
				{ id: "consult", scope: "project" },
				undefined,
				undefined,
				{ cwd: project },
			);

			const registry = loadTeamRegistry(CONFIG_PATH, { roots: [], cwd: project });
			expect(registry.teams.get("consult")?.source).toBe("builtin");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("team_delete rejects unknown team ids", async () => {
		const { api, tools } = createFakeApi();
		registerTeamRunTool(api, { stateManager: new TeamStateManager() });
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
		registerTeamRunTool(api, { stateManager: new TeamStateManager() });
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
		).rejects.toThrow(/No team "missing".*consult.*default-debate.*pair-coding/s);
	});
});
