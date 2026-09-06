/**
 * Tests for declarative team tools.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TeamStateManager } from "../../extensions/pi-teams/state.js";
import { registerTeamRunTool, summarizeTeamRuns } from "../../extensions/pi-teams/team-runtime.js";
import { loadTeamRegistry } from "../../extensions/pi-teams/team-registry.js";
import { registerTeamTools } from "../../extensions/pi-teams/team-tools.js";
import { createFakeApi, writeSubagent, writeTeam } from "./team-test-helpers.js";

const CONFIG_PATH = join(process.cwd(), "extensions", "pi-teams", "config", "config.json");

describe("team tools", () => {
	it("summarizes team run status without raw run text", () => {
		const entries: Array<{ type: string; customType?: string; data?: unknown }> = [];
		const stateManager = new TeamStateManager({ appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }) });
		const running = stateManager.startRun({ teamId: "navigator", protocol: "consult", prompt: "prompt with private objective" });
		const completed = stateManager.startRun({ teamId: "llm-council", protocol: "debate", prompt: "other private objective" });
		stateManager.recordPhaseStarted(running, "consult");
		stateManager.recordDetail(completed, { kind: "artifact", message: "artifact ready", artifactUri: "file://artifact.md" });
		stateManager.recordRunCompleted(completed, 10, "private summary body");
		stateManager.rehydrateFromSession({ getEntries: () => entries });

		const summary = summarizeTeamRuns(stateManager.list());

		expect(summary).toEqual({ total: 2, running: 1, pending: 0, stopping: 0, completed: 1, failed: 0, stopped: 0, artifacts: 1 });
		expect(JSON.stringify(summary)).not.toContain("private");
		expect(running).toMatch(/^team-/);
	});

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
		expect(peekResult.content[0]?.text).toContain("summary total=1 running=1 pending=0 stopping=0 completed=0 failed=0 stopped=0 artifacts=0");
		expect(peekResult.content[0]?.text).toContain(runId);
		expect(peekResult.content[0]?.text).toContain("research");
		expect(peekResult.details.summary).toEqual(expect.objectContaining({ total: 1, running: 1 }));

		await stop.execute("test", { runId, reason: "bounded test stop" }, undefined, undefined, { cwd: process.cwd() });
		const stopResult = await peek.execute("test", {}, undefined, undefined, { cwd: process.cwd() });
		expect(stopResult.content[0]?.text).toContain("stopping");
		expect(stopResult.details.runs).toEqual([
			expect.objectContaining({ status: "stopping", stopReason: "bounded test stop" }),
		]);
	});

	it.each([
		{
			scenario: "running",
			summary: "summary total=1 running=1 pending=0 stopping=0 completed=0 failed=0 stopped=0 artifacts=0",
			statusLine: "navigator consult running phases=1 nodes=1 (running=1 stalled=1 done=0) details=0 current=consult/node-1",
		},
		{
			scenario: "failed",
			summary: "summary total=1 running=0 pending=0 stopping=0 completed=0 failed=1 stopped=0 artifacts=0",
			statusLine: "navigator consult failed phases=1 nodes=1 (running=0 stalled=0 done=1) details=1 current=consult/node-1 error=test failure",
		},
		{
			scenario: "no-nodes",
			summary: "summary total=1 running=0 pending=1 stopping=0 completed=0 failed=0 stopped=0 artifacts=0",
			statusLine: "navigator consult pending phases=0 nodes=0 (running=0 stalled=0 done=0) details=0 current=-",
		},
	])("preserves team list and detail output for $scenario runs", async ({ scenario, summary, statusLine }) => {
		const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
		try {
			const entries: Array<{ type: string; customType?: string; data?: unknown }> = [];
			const stateManager = new TeamStateManager({ appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }) });
			const runId = stateManager.startRun({ teamId: "navigator", protocol: "consult", prompt: "test" });
			if (scenario !== "no-nodes") {
				stateManager.recordPhaseStarted(runId, "consult");
				stateManager.recordNodeStarted(runId, { phaseId: "consult", nodeId: "node-1", role: "navigator", model: "test-model" });
			}
			if (scenario === "failed") {
				stateManager.recordNodeCompleted(runId, { phaseId: "consult", nodeId: "node-1", role: "navigator", model: "test-model", ok: false, durationMs: 10, output: "", error: "test failure" });
				stateManager.recordRunFailed(runId, "test failure");
			}
			stateManager.rehydrateFromSession({ getEntries: () => entries });
			clock.mockReturnValue(200_000);
			const { api, tools } = createFakeApi();
			registerTeamRunTool(api, { stateManager });
			const peek = tools.get("team_runs");
			if (!peek) throw new Error("team_runs missing");

			const peekResult = await peek.execute("test", {});
			const detailResult = await peek.execute("test", { runId });
			const line = `${runId} ${statusLine}`;
			expect(peekResult.content[0]?.text).toBe(`${summary}\n${line}`);
			expect(detailResult).toEqual(peekResult);
			expect(peekResult.details.runs).toEqual(stateManager.list());
		} finally {
			clock.mockRestore();
		}
	});

	it("exposes one status surface and rejects unknown run IDs", async () => {
		const { api, tools } = createFakeApi();
		registerTeamRunTool(api, { stateManager: new TeamStateManager() });
		const peek = tools.get("team_runs");
		if (!peek) throw new Error("team_runs missing");
		expect((await peek.execute("test", {})).content[0]?.text).toBe("No team runs in current session state.");
		await expect(peek.execute("test", { runId: "missing" })).rejects.toThrow("No team run missing");
		expect(tools.has("runtime_status")).toBe(false);
		expect(tools.has("runtime_stop")).toBe(false);
	});

	it("team_stop omits runId to stop the deterministic newest active run", async () => {
		const entries: Array<{ type: string; customType?: string; data?: unknown }> = [];
		const stateManager = new TeamStateManager({ appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }) });
		stateManager.startRun({ teamId: "older", protocol: "consult", prompt: "test" });
		stateManager.startRun({ teamId: "newer", protocol: "consult", prompt: "test" });
		stateManager.rehydrateFromSession({ getEntries: () => entries });
		const expectedRunId = stateManager.newestActiveRun()?.id;
		const { api, tools } = createFakeApi();
		registerTeamRunTool(api, { stateManager });
		const stop = tools.get("team_stop");
		if (!stop || !expectedRunId) throw new Error("team_stop setup failed");

		const result = await stop.execute("test", {}, undefined, undefined, { cwd: process.cwd() });

		expect(result.details).toEqual(expect.objectContaining({ runId: expectedRunId, status: "stopping" }));
		expect(stateManager.get(expectedRunId)?.status).toBe("stopping");
		const schema = stop.parameters as { required?: string[] };
		expect(schema.required ?? []).not.toContain("runId");
	});

	it("uses the same state for live status, cancellation and restored status", async () => {
		const entries: Array<{ type: string; customType?: string; data?: unknown }> = [];
		const stateManager = new TeamStateManager({ appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }) });
		const runId = stateManager.startRun({ teamId: "navigator", protocol: "consult", prompt: "test" });
		const controller = new AbortController();
		stateManager.registerAbortController(runId, controller);
		const { api, tools } = createFakeApi();
		registerTeamRunTool(api, { stateManager });
		const peek = tools.get("team_runs"), stop = tools.get("team_stop");
		if (!peek || !stop) throw new Error("team tools missing");
		expect((await peek.execute("test", { runId })).details.runs).toEqual([expect.objectContaining({ status: "pending" })]);
		await stop.execute("test", { runId });
		expect(controller.signal.aborted).toBe(true);
		const eventCount = entries.length;
		const repeated = await stop.execute("test", { runId, reason: "different reason" });
		expect(repeated.details.reason).toBe("stop requested");
		expect(entries).toHaveLength(eventCount);
		const restored = new TeamStateManager();
		restored.rehydrateFromSession({ getEntries: () => entries });
		expect(restored.list()).toEqual(stateManager.list());
		expect((await peek.execute("test", { runId })).details.runs).toEqual([expect.objectContaining({ status: "stopping" })]);
	});

	it.each(["completed", "failed", "stopped"])("rejects stopping a %s run without altering history", async (status) => {
		const entries: unknown[] = [];
		const stateManager = new TeamStateManager({ appendEntry: (_type, entry) => entries.push(entry) });
		const runId = stateManager.startRun({ teamId: "navigator", protocol: "consult", prompt: "test" });
		if (status === "completed") stateManager.recordRunCompleted(runId, 1);
		else if (status === "failed") stateManager.recordRunFailed(runId, "failure");
		else stateManager.recordRunStopped(runId, 1, "stopped");
		const count = entries.length;
		const { api, tools } = createFakeApi();
		registerTeamRunTool(api, { stateManager });
		const stop = tools.get("team_stop");
		if (!stop) throw new Error("team_stop missing");
		await expect(stop.execute("test", { runId })).rejects.toThrow("No active team run");
		expect(entries).toHaveLength(count);
		expect(stateManager.get(runId)?.status).toBe(status);
	});

	it("team_run exposes the shared typed profile schema", () => {
		const { api, tools } = createFakeApi();
		registerTeamRunTool(api, { stateManager: new TeamStateManager() });
		const run = tools.get("team_run");
		if (!run) throw new Error("team_run missing");

		const schema = run.parameters as { properties?: { profile?: { enum?: string[] } } };
		expect(schema.properties?.profile?.enum).toEqual(["fast", "balanced", "thorough"]);
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
