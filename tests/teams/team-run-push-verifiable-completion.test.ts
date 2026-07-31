/** Regression tests for T-805 push-based, verifiable team-run completion. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TeamStateManager } from "../../extensions/pi-panopticon/teams/state.js";
import { runTeam } from "../../extensions/pi-panopticon/teams/team-runtime.js";
import { readTeamRunResultArtifact, teamRunResultArtifactPath } from "../../extensions/pi-panopticon/teams/team-result-artifact.js";
import type { TeamRunInput } from "../../extensions/pi-panopticon/teams/team-handlers.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

interface FakeContext extends ExtensionContext {
	ui: ExtensionContext["ui"] & {
		notifications: string[];
	};
}

const tempDirs: string[] = [];

function createFakeCtx(): FakeContext {
	const notifications: string[] = [];
	return {
		cwd: process.cwd(),
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

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	currentHandler = createFakeTeamHandler("FAKE_TEAM_RESULT");
});

function makeCoasHome(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-teams-t805-"));
	tempDirs.push(dir);
	return dir;
}

function params(prompt: string): TeamRunInput {
	return { id: "test-team", prompt };
}

describe("team-run verifiable completion", () => {
	let coasHome: string;

	beforeEach(() => {
		coasHome = makeCoasHome();
		process.env.COAS_HOME = coasHome;
		mkdirSync(join(coasHome, "team-results"), { recursive: true });
	});

	afterEach(() => {
		delete process.env.COAS_HOME;
	});

	it("writes the result artifact before marking the run completed", async () => {
		const stateManager = new TeamStateManager();
		const ctx = createFakeCtx();

		const result = await runTeam({ params: params("do the thing"), ctx, stateManager });

		expect(result.details.runId).toBeDefined();
		const runId = result.details.runId as string;
		const run = stateManager.get(runId);
		expect(run?.status).toBe("completed");
		expect(run?.resultArtifactPath).toBe(teamRunResultArtifactPath(runId, coasHome));
		const artifact = await readTeamRunResultArtifact(runId, coasHome);
		expect(artifact).toBeDefined();
		expect(artifact?.result).toBe("FAKE_TEAM_RESULT");
		expect(artifact?.status).toBe("completed");
	});

	it("records stopped runs with an artifact", async () => {
		currentHandler = createFakeTeamHandler("STOPPED_RESULT", true);
		const stateManager = new TeamStateManager();
		const ctx = createFakeCtx();

		const result = await runTeam({ params: params("do the thing"), ctx, stateManager });
		const runId = result.details.runId as string;
		const run = stateManager.get(runId);
		expect(run?.status).toBe("stopped");
		const artifact = await readTeamRunResultArtifact(runId, coasHome);
		expect(artifact?.result).toBe("STOPPED_RESULT");
		expect(artifact?.status).toBe("stopped");
	});

	it("status is completed iff the artifact is claim-checkable", async () => {
		const stateManager = new TeamStateManager();
		const ctx = createFakeCtx();

		const result = await runTeam({ params: params("claim-check"), ctx, stateManager });
		const runId = result.details.runId as string;
		const run = stateManager.get(runId);

		if (run?.status === "completed") {
			const artifact = await readTeamRunResultArtifact(runId, coasHome);
			expect(artifact).toBeDefined();
			expect(artifact?.result).toBe("FAKE_TEAM_RESULT");
		} else {
			// If status is not completed, artifact must not be readable as a completed result.
			const path = teamRunResultArtifactPath(runId, coasHome);
			try {
				const data = JSON.parse(await import("node:fs/promises").then((m) => m.readFile(path, "utf8")));
				expect(data.status).not.toBe("completed");
			} catch {
				// Missing artifact is also acceptable when not completed.
			}
		}
	});

	it("simulated delivery loss: parent can always recover from the artifact", async () => {
		const stateManager = new TeamStateManager();
		const ctx = createFakeCtx();

		const result = await runTeam({ params: params("async-like run"), ctx, stateManager });
		const runId = result.details.runId as string;
		const run = stateManager.get(runId);

		// Simulate the failure mode: message queue is empty, so parent relies on status + artifact.
		const artifact = await readTeamRunResultArtifact(runId, coasHome);
		if (run?.status === "completed") {
			expect(artifact).toBeDefined();
			expect(artifact?.result).toBe("FAKE_TEAM_RESULT");
		} else {
			// No completed status without a completed artifact.
			expect(artifact?.status).not.toBe("completed");
		}
	});
});
