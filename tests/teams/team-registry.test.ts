/**
 * Tests for declarative team specs.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTeamRegistry } from "../../extensions/pi-panopticon/teams/team-registry.js";
import type { TeamSpec } from "../../extensions/pi-panopticon/teams/team-types.js";
import { withTempConfig, writeSubagent, writeTeam } from "./team-test-helpers.js";

const CONFIG_PATH = join(
	process.cwd(),
	"extensions",
	"pi-panopticon",
	"teams",
	"config",
	"config.json",
);
function requireTeam(registry: ReturnType<typeof loadTeamRegistry>, id: string): TeamSpec {
	const team = registry.teams.get(id);
	if (!team) throw new Error(`Missing team ${id}`);
	return team;
}

describe("loadTeamRegistry", () => {
	it("loads built-in teams and validates subagent references", async () => {
		const registry = loadTeamRegistry(CONFIG_PATH, { roots: [] });

		expect([...registry.teams.keys()].sort()).toEqual([
			"deep-research",
			"fusion-analysis",
			"llm-council",
			"navigator",
			"router-fusion",
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
		expect(requireTeam(registry, "router-fusion")).toMatchObject({
			protocol: "fusion",
			limits: { maxLoops: 3 },
		});
		expect(requireTeam(registry, "fusion-analysis")).toMatchObject({
			protocol: "fusion-analysis",
			limits: { maxLoops: 3 },
		});
	});

	it("accepts explicit-binding teams with custom protocol labels", async () => {
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

	it("derives subagent execution config from protocol and manifests", async () => {
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

	it("lets binding config explicitly override subagent config with empty values", async () => {
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

	it("loads graph protocol manifests as unsupported legacy teams and ignores graph fields", async () => {
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

	it("derives role model bindings from object agent entries", async () => {
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

	it("reports missing live-agent refs without requiring subagent ids", async () => {
		withTempConfig((configPath, root) => {
			writeTeam(root, "live-consult", "agent:definitely-missing-live-peer");

			const registry = loadTeamRegistry(configPath);

			expect(registry.teams.has("live-consult")).toBe(true);
			expect(registry.warnings.some((warning) => warning.startsWith("live-consult: live agent agent:definitely-missing-live-peer is not registered"))).toBe(true);
			expect(registry.warnings.some((warning) => warning.includes("invalid agent id"))).toBe(false);
		});
	});

	it("rejects mixed object and string agent lists", async () => {
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

	it("reports unknown subagent references", async () => {
		withTempConfig((configPath, root) => {
			writeSubagent(root, "known_agent");
			writeTeam(root, "broken", "missing_agent");

			const registry = loadTeamRegistry(configPath);

			expect(registry.teams.has("broken")).toBe(true);
			expect(registry.warnings).toContain("broken: unknown agent missing_agent");
		});
	});

	it("loads user and project teams after built-ins", async () => {
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

});
