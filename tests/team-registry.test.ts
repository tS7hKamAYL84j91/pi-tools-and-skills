/**
 * Tests for declarative team specs.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTeamFiles, deleteTeamFiles, updateTeamModels } from "../extensions/pi-teams/team-form.js";
import { validateTeamManifest } from "../extensions/pi-teams/team-manifest.js";
import { modelSlotsForTeam } from "../extensions/pi-teams/team-handlers.js";
import { loadTeamRegistry } from "../extensions/pi-teams/team-registry.js";
import type { TeamSpec } from "../extensions/pi-teams/team-types.js";
import { withTempConfig, writeSubagent, writeTeam } from "./team-test-helpers.js";

const CONFIG_PATH = join(
	process.cwd(),
	"extensions",
	"pi-teams",
	"config",
	"config.json",
);
function requireTeam(registry: ReturnType<typeof loadTeamRegistry>, id: string): TeamSpec {
	const team = registry.teams.get(id);
	if (!team) throw new Error(`Missing team ${id}`);
	return team;
}

describe("loadTeamRegistry", () => {
	it("loads built-in teams and validates subagent references", () => {
		const registry = loadTeamRegistry(CONFIG_PATH, { roots: [] });

		expect([...registry.teams.keys()].sort()).toEqual([
			"deep-research",
			"llm-council",
			"navigator",
		]);
		expect(registry.warnings).toEqual([]);
		const deepResearch = requireTeam(registry, "deep-research");
		expect(deepResearch.protocol).toBe("research");
		expect(deepResearch.limits.maxLoops).toBe(2);
		const defaultDebate = requireTeam(registry, "llm-council");
		expect(defaultDebate).toMatchObject({
			protocol: "debate",
		});
		expect(defaultDebate.agentBindings.filter((binding) => binding.role === "member")).toHaveLength(4);
		expect(defaultDebate.agentBindings.filter((binding) => binding.subagent === "debate_generation_member")).toHaveLength(4);
		expect(requireTeam(registry, "navigator").agents).toEqual([
			"consult_navigator",
		]);
	});

	it("accepts explicit-binding teams with custom protocol labels", () => {
		withTempConfig((configPath, root) => {
			writeSubagent(root, "custom_agent_1");
			writeSubagent(root, "custom_agent_2");
			writeFileSync(
				join(root, "teams", "custom-chain.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "custom-chain"',
					'name: "Custom Chain"',
					'protocol: "custom-chain"',
					"agents:",
					'  - role: "agent_1"',
					'    subagent: "custom_agent_1"',
					'  - role: "agent_2"',
					'    subagent: "custom_agent_2"',
					"---",
					"Team body.",
				].join("\n"),
				"utf8",
			);

			const registry = loadTeamRegistry(configPath, { roots: [] });

			expect(registry.warnings).toEqual([]);
			expect(registry.teams.get("custom-chain")).toMatchObject({
				protocol: "custom-chain",
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
			writeTeam(join(project, ".pi", "teams"), "navigator", "project_agent");

			const registry = loadTeamRegistry(configPath, { settingsPath: join(root, "settings.json"), cwd: project });

			expect(registry.teams.get("user-team")?.source).toBe("user");
			expect(registry.teams.get("navigator")?.source).toBe("project");
			expect(registry.teams.get("navigator")?.agents).toEqual([
				"project_agent",
			]);
		});
	});

	it("team_form writes project teams to the default project root so they are immediately discoverable", () => {
		const project = mkdtempSync(join(tmpdir(), "team-form-project-root-"));
		try {
			writeFileSync(join(project, "package.json"), "{}", "utf8");

			const result = createTeamFiles({
				id: "project-consult",
				protocol: "consult",
				agents: ["project_navigator"],
				scope: "project",
			}, project);
			const registry = loadTeamRegistry(undefined, { cwd: project });

			expect(result.teamPath).toBe(join(project, ".pi", "teams", "teams", "project-consult.md"));
			expect(registry.teams.get("project-consult")?.source).toBe("project");
			expect(registry.warnings.filter((warning) => warning.startsWith("project-consult:"))).toEqual([]);
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});

	it("team_form rejects removed telephone protocol without explicit bindings", () => {
		const project = mkdtempSync(join(tmpdir(), "team-form-telephone-"));
		try {
			writeFileSync(join(project, "package.json"), "{}", "utf8");

			expect(() => createTeamFiles({
				id: "telephone-game",
				protocol: "telephone",
				agents: ["relay_1", "relay_2"],
				scope: "project",
			}, project)).toThrow("Unsupported team protocol telephone.");
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
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
