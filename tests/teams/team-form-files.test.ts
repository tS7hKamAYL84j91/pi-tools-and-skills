/**
 * Tests for team file mutation helpers.
 */

import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTeamFiles, deleteTeamFiles, updateTeamModels } from "../../extensions/pi-teams/team-form.js";
import { loadTeamRegistry } from "../../extensions/pi-teams/team-registry.js";
import type { TeamSpec } from "../../extensions/pi-teams/team-types.js";
import { withTempProjectRoot, writeSubagent } from "./team-test-helpers.js";

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

function teamAuthority(id: string, subagent = "safe_navigator"): string {
	return [
		"---",
		"schemaVersion: 2",
		`id: "${id}"`,
		'protocol: "consult"',
		"agents:",
		'  - role: "navigator"',
		`    subagent: "${subagent}"`,
		"---",
		"Confined team.",
	].join("\n");
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

	it("team_form rejects unsafe generated subagent ids before creating files", async () => {
		await withTempProjectRoot("team-form-confinement-", async (project) => {
			const unsafeIds = [
				"../escaped",
				"nested/agent",
				"nested\\agent",
				join(project, "absolute-agent"),
				"%2e%2e%2fescaped",
				".hidden",
				"trailing.",
				"-leading",
				"trailing-",
			];

			for (const [index, subagent] of unsafeIds.entries()) {
				await expect(createTeamFiles({
					id: `unsafe-${index}`,
					protocol: "consult",
					agents: [subagent],
					scope: "project",
				}, project)).rejects.toThrow("Invalid generated subagent id");
			}

			expect(existsSync(join(project, ".pi", "teams", "escaped.md"))).toBe(false);
			expect(existsSync(join(project, "absolute-agent.md"))).toBe(false);
		});
	});

	it("team_form preserves safe dotted generated subagent ids", async () => {
		await withTempProjectRoot("team-form-dotted-id-", async (project) => {
			const result = await createTeamFiles({
				id: "dotted-review",
				protocol: "consult",
				agents: ["review.v2"],
				scope: "project",
			}, project);

			expect(result.subagentPaths).toEqual([
				join(project, ".pi", "teams", "agents", "review.v2.md"),
			]);
		});
	});

	it("rejects a symlinked generated-agents directory before create or delete access", async () => {
		await withTempProjectRoot("team-form-agents-symlink-", async (project) => {
			const teamsRoot = join(project, ".pi", "teams");
			const redirectedAgents = join(project, "redirected-agents");
			const agentsDir = join(teamsRoot, "agents");
			mkdirSync(join(teamsRoot, "teams"), { recursive: true });
			mkdirSync(redirectedAgents);
			symlinkSync(redirectedAgents, agentsDir, "dir");

			await expect(createTeamFiles({
				id: "symlink-review",
				protocol: "consult",
				agents: ["safe_navigator"],
				scope: "project",
			}, project)).rejects.toThrow(/symlink/);
			expect(existsSync(join(redirectedAgents, "safe_navigator.md"))).toBe(false);

			const teamPath = join(teamsRoot, "teams", "symlink-review.md");
			const redirectedSubagent = join(redirectedAgents, "safe_navigator.md");
			writeFileSync(redirectedSubagent, 'generatedBy: "pi-teams"\n', "utf8");
			writeFileSync(teamPath, [
				"---",
				"schemaVersion: 2",
				'id: "symlink-review"',
				'protocol: "consult"',
				"agents:",
				'  - role: "navigator"',
				'    subagent: "safe_navigator"',
				"---",
				"Symlinked agents directory team.",
			].join("\n"), "utf8");

			await expect(deleteTeamFiles({ id: "symlink-review", scope: "project" }, project))
				.rejects.toThrow(/symlink/);
			expect(existsSync(teamPath)).toBe(true);
			expect(existsSync(redirectedSubagent)).toBe(true);
		});
	});

	it("rejects a symlinked teams directory for create, update, and delete", async () => {
		await withTempProjectRoot("team-form-teams-root-symlink-", async (project) => {
			const teamsRoot = join(project, ".pi", "teams");
			const teamsDir = join(teamsRoot, "teams");
			const redirectedTeams = join(project, "redirected-teams");
			mkdirSync(teamsRoot, { recursive: true });
			mkdirSync(redirectedTeams);
			symlinkSync(redirectedTeams, teamsDir, "dir");

			await expect(createTeamFiles({
				id: "create-review",
				protocol: "consult",
				agents: ["safe_navigator"],
				scope: "project",
			}, project)).rejects.toThrow(/symlink/);

			const authorityPath = join(redirectedTeams, "linked-review.md");
			const authority = teamAuthority("linked-review");
			writeFileSync(authorityPath, authority, "utf8");
			await expect(updateTeamModels({
				id: "linked-review",
				models: { navigator: "test/model" },
				scope: "project",
			}, project)).rejects.toThrow(/symlink/);
			await expect(deleteTeamFiles({ id: "linked-review", scope: "project" }, project))
				.rejects.toThrow(/symlink/);
			expect(readFileSync(authorityPath, "utf8")).toBe(authority);
		});
	});

	it("rejects a symlinked final team file for create, update, and delete", async () => {
		await withTempProjectRoot("team-form-team-file-symlink-", async (project) => {
			const teamsDir = join(project, ".pi", "teams", "teams");
			mkdirSync(teamsDir, { recursive: true });
			const authorityPath = join(project, "foreign-team.md");
			const authority = teamAuthority("linked-review");
			writeFileSync(authorityPath, authority, "utf8");
			const teamPath = join(teamsDir, "linked-review.md");
			symlinkSync(authorityPath, teamPath);

			await expect(createTeamFiles({
				id: "linked-review",
				protocol: "consult",
				agents: ["safe_navigator"],
				scope: "project",
				overwrite: true,
			}, project)).rejects.toThrow(/symlink/);
			await expect(updateTeamModels({
				id: "linked-review",
				models: { navigator: "test/model" },
				scope: "project",
			}, project)).rejects.toThrow(/symlink/);
			await expect(deleteTeamFiles({ id: "linked-review", scope: "project" }, project))
				.rejects.toThrow(/symlink/);
			expect(readFileSync(authorityPath, "utf8")).toBe(authority);
			expect(existsSync(teamPath)).toBe(true);
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

	it("team_delete rejects traversal in generated subagent ids without deleting the escaped file", async () => {
		await withTempProjectRoot("team-delete-confinement-", async (project) => {
			const teamsRoot = join(project, ".pi", "teams");
			const escapedPath = join(teamsRoot, "escaped.md");
			mkdirSync(join(teamsRoot, "agents"), { recursive: true });
			mkdirSync(join(teamsRoot, "teams"), { recursive: true });
			writeFileSync(escapedPath, 'generatedBy: "pi-teams"\n', "utf8");
			writeFileSync(
				join(teamsRoot, "teams", "unsafe-delete.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "unsafe-delete"',
					'protocol: "consult"',
					"agents:",
					'  - role: "navigator"',
					'    subagent: "../escaped"',
					"---",
					"Unsafe team.",
				].join("\n"),
				"utf8",
			);

			expect(loadTeamRegistry(undefined, { cwd: project }).teams.get("unsafe-delete")).toMatchObject({
				source: "project",
				agents: ["../escaped"],
			});
			await expect(deleteTeamFiles({ id: "unsafe-delete", scope: "project" }, project))
				.rejects.toThrow("Invalid generated subagent id");
			expect(readFileSync(escapedPath, "utf8")).toContain('generatedBy: "pi-teams"');
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

	it("team_form creates a valid, compilable hierarchical-swarm team manifest", async () => {
		await withTempProjectRoot("team-form-swarm-", async (project) => {
			const result = await createTeamFiles({
				id: "custom-swarm",
				protocol: "hierarchical-swarm",
				agents: ["swarm_root", "swarm_mgr", "swarm_worker"],
				scope: "project",
			}, project);
			const registry = loadTeamRegistry(undefined, { cwd: project });
			const team = requireTeam(registry, "custom-swarm");

			expect(result.teamPath).toBe(join(project, ".pi", "teams", "teams", "custom-swarm.md"));
			expect(team.protocol).toBe("hierarchical-swarm");
			expect(team.hierarchicalSwarm).toBeDefined();
			expect(team.hierarchicalSwarm?.bounds.maxWip).toBe(3);
			expect(team.hierarchicalSwarm?.roleTemplates).toHaveLength(3);
			expect(team.hierarchicalSwarm?.roleTemplates[0]?.role).toBe("root");
			expect(team.hierarchicalSwarm?.roleTemplates[0]?.bindingRole).toBe("root_orchestrator");
			expect(team.agentBindings).toHaveLength(3);
			expect(team.agentBindings[0]?.subagent).toBe("swarm_root");
			expect(team.agentBindings[1]?.subagent).toBe("swarm_mgr");
			expect(team.agentBindings[2]?.subagent).toBe("swarm_worker");
		});
	});

});
