/**
 * Tests for declarative team tools.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TeamStateManager } from "../extensions/pi-teams/state.js";
import { registerTeamRunTool } from "../extensions/pi-teams/team-runtime.js";
import { loadTeamRegistry } from "../extensions/pi-teams/team-registry.js";
import { registerTeamTools } from "../extensions/pi-teams/team-tools.js";
import { createFakeApi, writeSubagent, writeTeam } from "./team-test-helpers.js";

const CONFIG_PATH = join(process.cwd(), "extensions", "pi-teams", "config", "config.json");

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

		expect(result.content[0]?.text).toContain("llm-council");
		expect(result.details.teams).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "navigator", protocol: "consult" }),
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
			{ id: "navigator" },
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
				{ id: "llm-council" },
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
			writeTeam(join(project, ".pi", "teams"), "navigator", "project_agent");
			const { api, tools } = createFakeApi();
			registerTeamRunTool(api, { stateManager: new TeamStateManager() });
			const remove = tools.get("team_delete");
			if (!remove) throw new Error("team_delete missing");

			await remove.execute(
				"test",
				{ id: "navigator", scope: "project" },
				undefined,
				undefined,
				{ cwd: project },
			);

			const registry = loadTeamRegistry(CONFIG_PATH, { roots: [], cwd: project });
			expect(registry.teams.get("navigator")?.source).toBe("builtin");
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

	it("team_runs peeks progress and team_stop records a stop", async () => {
		const entries: Array<{ type: string; customType?: string; data?: unknown }> = [];
		const stateManager = new TeamStateManager({ appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }) });
		const runId = stateManager.startRun({ teamId: "deep-research", protocol: "research", prompt: "test" });
		stateManager.recordPhaseStarted(runId, "research_loop_1", "Research loop 1/2");
		stateManager.rehydrateFromSession({ getEntries: () => entries });
		const { api, tools } = createFakeApi();
		registerTeamRunTool(api, { stateManager });
		const peek = tools.get("team_runs");
		const stop = tools.get("team_stop");
		if (!peek || !stop) throw new Error("team control tools missing");

		const peekResult = await peek.execute("test", {}, undefined, undefined, { cwd: process.cwd() });
		expect(peekResult.content[0]?.text).toContain(runId);
		expect(peekResult.content[0]?.text).toContain("research");

		await stop.execute("test", { runId, reason: "bounded test stop" }, undefined, undefined, { cwd: process.cwd() });
		const stopResult = await peek.execute("test", {}, undefined, undefined, { cwd: process.cwd() });
		expect(stopResult.content[0]?.text).toContain("stopping");
		expect(stopResult.details.runs).toEqual([
			expect.objectContaining({ status: "stopping", stopReason: "bounded test stop" }),
		]);
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
		).rejects.toThrow(/No team "missing".*llm-council.*navigator/s);
	});
});
