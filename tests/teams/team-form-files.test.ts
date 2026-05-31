/**
 * Tests for team file mutation helpers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTeamFiles, deleteTeamFiles, updateTeamModels } from "../../extensions/pi-panopticon/teams/team-form.js";
import { loadTeamRegistry } from "../../extensions/pi-panopticon/teams/team-registry.js";
import type { TeamSpec } from "../../extensions/pi-panopticon/teams/team-types.js";
import { withTempProjectRoot, writeSubagent } from "./team-test-helpers.js";

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

describe("team file mutations", () => {
	it("team_form writes project teams to the default project root so they are immediately discoverable", async () => {
		await withTempProjectRoot("team-form-project-root-", async (project) => {
			const result = await createTeamFiles({
				id: "project-consult",
				protocol: "consult",
				agents: ["project_navigator"],
				scope: "project",
			}, project);
			const registry = loadTeamRegistry(undefined, { cwd: project });

			expect(result.teamPath).toBe(join(project, ".pi", "teams", "teams", "project-consult.md"));
			expect(registry.teams.get("project-consult")?.source).toBe("project");
			expect(registry.warnings.filter((warning) => warning.startsWith("project-consult:"))).toEqual([]);
		});
	});

	it("team_form rejects removed telephone protocol without explicit bindings", async () => {
		await withTempProjectRoot("team-form-telephone-", async (project) => {
			await expect(createTeamFiles({
				id: "telephone-game",
				protocol: "telephone",
				agents: ["relay_1", "relay_2"],
				scope: "project",
			}, project)).rejects.toThrow("Unsupported team protocol telephone.");
		});
	});

	it("team_form creates runnable debate bindings without member models", async () => {
		await withTempProjectRoot("team-form-debate-", async (project) => {
			const result = await createTeamFiles({
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
		});
	});

	it("team_form preserves live-agent refs without creating subagent stubs", async () => {
		await withTempProjectRoot("team-form-live-", async (project) => {
			const result = await createTeamFiles({
				id: "live-review",
				protocol: "consult",
				agents: ["agent:reviewer"],
				scope: "project",
			}, project);
			const body = readFileSync(result.teamPath, "utf8");

			expect(body).toContain('subagent: "agent:reviewer"');
			expect(result.subagentPaths).toEqual([]);
			expect(existsSync(join(project, ".pi", "teams", "agents", "agent:reviewer.md"))).toBe(false);
		});
	});

	it("team_delete removes unreferenced generated subagent stubs", async () => {
		await withTempProjectRoot("team-delete-generated-", async (project) => {
			mkdirSync(join(project, ".pi"), { recursive: true });
			writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({ teams: { roots: [".pi/teams"] } }), "utf8");
			const result = await createTeamFiles({ id: "generated-review", protocol: "consult", agents: ["generated_navigator"], scope: "project" }, project);
			const subagentPath = join(project, ".pi", "teams", "agents", "generated_navigator.md");

			expect(result.subagentPaths).toEqual([subagentPath]);
			expect(readFileSync(subagentPath, "utf8")).toContain('generatedBy: "pi-teams"');

			await deleteTeamFiles({ id: "generated-review", scope: "project" }, project);

			expect(existsSync(result.teamPath)).toBe(false);
			expect(existsSync(subagentPath)).toBe(false);
		});
	});

	it("team_models preserves binding config while dropping legacy graph policy", async () => {
		await withTempProjectRoot("team-models-graph-", async (project) => {
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

			await updateTeamModels({ id: "review-qa", models: { members: ["new/review", "new/qa"] } }, project);
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
		});
	});

});
