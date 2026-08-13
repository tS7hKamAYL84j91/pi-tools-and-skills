/** Regression tests for T-805 push-based, verifiable team-run completion. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TeamStateManager } from "../../extensions/pi-panopticon/teams/state.js";
import { runTeam } from "../../extensions/pi-panopticon/teams/team-runtime.js";
import { readTeamRunResultArtifact, teamRunResultArtifactPath } from "../../extensions/pi-panopticon/teams/team-result-artifact.js";
import type { TeamRunInput } from "../../extensions/pi-panopticon/teams/team-handlers.js";

interface FakeContext extends ExtensionContext {
	ui: ExtensionContext["ui"] & {
		notifications: string[];
	};
}

const tempDirs: string[] = [];

function createFakeCtx(cwd: string): FakeContext {
	const notifications: string[] = [];
	return {
		cwd,
		signal: undefined,
		ui: {
			notify: (message: string, level: "info" | "warning") => {
				notifications.push(`${level}:${message}`);
			},
			setStatus: () => {},
			setWidget: () => {},
			notifications,
		} as unknown as ExtensionContext["ui"] & { notifications: string[] },
		hasUI: false,
		sessionManager: {} as unknown as ExtensionContext["sessionManager"],
		modelRegistry: {} as unknown as ExtensionContext["modelRegistry"],
		model: undefined,
		isIdle: () => true,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
	};
}

function createFakeTeamHandler(resultText: string, stopped = false) {
	return {
		async run() {
			return {
				content: [{ type: "text" as const, text: resultText }],
				details: { stopped, reason: stopped ? "cancelled" : undefined },
			};
		},
	};
}

let currentHandler = createFakeTeamHandler("FAKE_TEAM_RESULT");

vi.mock("../../extensions/pi-panopticon/teams/team-handlers.js", () => ({
	TEAM_STATUS_KEY: "teams:status",
	getTeamHandler: vi.fn(() => currentHandler),
}));

vi.mock("../../extensions/pi-panopticon/teams/team-registry.js", () => ({
	loadTeamRegistry: vi.fn(() => ({
		teams: new Map([[
			"test-team",
			{
				id: "test-team",
				name: "Test Team",
				protocol: "consult",
				agents: ["fake-agent"],
				agentBindings: [],
				models: {},
				limits: {},
				prompts: {},
				source: "project",
				path: "/tmp/fake-team.json",
			},
		]]),
		warnings: [],
	})),
}));

vi.mock("../../extensions/pi-panopticon/teams/team-paths.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../extensions/pi-panopticon/teams/team-paths.js")>();
	return {
		...actual,
		resolveTeamResultRoot: vi.fn(() => {
			const root = process.env.PI_TEAMS_TEST_RESULT_ROOT;
			if (!root) throw new Error("missing test result root");
			return root;
		}),
	};
});

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function params(prompt: string): TeamRunInput {
	return { id: "test-team", prompt };
}

describe("team-run verifiable completion", () => {
	let resultRoot: string;
	let cwd: string;

	beforeEach(() => {
		resultRoot = join(makeTempDir("pi-teams-results-"), "user-teams", "results");
		cwd = makeTempDir("pi-teams-workspace-");
		process.env.PI_TEAMS_TEST_RESULT_ROOT = resultRoot;
		process.env.COAS_HOME = makeTempDir("pi-teams-coas-");
	});

	afterEach(() => {
		delete process.env.PI_TEAMS_TEST_RESULT_ROOT;
		delete process.env.COAS_HOME;
		for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
		currentHandler = createFakeTeamHandler("FAKE_TEAM_RESULT");
	});

	it("writes outside cwd and COAS_HOME before marking the run completed", async () => {
		const stateManager = new TeamStateManager();
		const result = await runTeam({ params: params("do the thing"), ctx: createFakeCtx(cwd), stateManager });
		const runId = result.details.runId;
		const run = stateManager.get(runId);

		expect(run?.status).toBe("completed");
		expect(run?.resultArtifactPath).toBe(teamRunResultArtifactPath(runId, resultRoot));
		expect(run?.resultArtifactPath).not.toContain(cwd);
		expect(run?.resultArtifactPath).not.toContain(process.env.COAS_HOME);
		const artifact = await readTeamRunResultArtifact(runId, resultRoot);
		expect(artifact).toMatchObject({ result: "FAKE_TEAM_RESULT", status: "completed" });
	});

	it("records stopped runs with an artifact", async () => {
		currentHandler = createFakeTeamHandler("STOPPED_RESULT", true);
		const stateManager = new TeamStateManager();
		const result = await runTeam({ params: params("do the thing"), ctx: createFakeCtx(cwd), stateManager });
		const runId = result.details.runId;

		expect(stateManager.get(runId)?.status).toBe("stopped");
		expect(await readTeamRunResultArtifact(runId, resultRoot)).toMatchObject({
			result: "STOPPED_RESULT",
			status: "stopped",
		});
	});

	it("completed status has a claim-checkable artifact", async () => {
		const stateManager = new TeamStateManager();
		const result = await runTeam({ params: params("claim-check"), ctx: createFakeCtx(cwd), stateManager });
		const runId = result.details.runId;

		expect(stateManager.get(runId)?.status).toBe("completed");
		expect(await readTeamRunResultArtifact(runId, resultRoot)).toMatchObject({
			result: "FAKE_TEAM_RESULT",
			status: "completed",
		});
	});

	it("recovers the result artifact after simulated delivery loss", async () => {
		const stateManager = new TeamStateManager();
		const result = await runTeam({ params: params("async-like run"), ctx: createFakeCtx(cwd), stateManager });
		const artifact = await readTeamRunResultArtifact(result.details.runId, resultRoot);

		expect(artifact).toMatchObject({ result: "FAKE_TEAM_RESULT", status: "completed" });
	});
});
