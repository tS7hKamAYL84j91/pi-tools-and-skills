import { describe, expect, it, vi } from "vitest";
import { TeamStateManager } from "../extensions/pi-teams/state.js";
import type { TeamAgentBinding, TeamSpec } from "../extensions/pi-teams/team-types.js";

let activeStateManager: TeamStateManager;
let activeRunId: string;
let stopAfterRole: string | undefined;
let activeEntries: Array<{ type: "custom"; customType: string; data?: unknown }> = [];
const callRoles: string[] = [];

vi.mock("../extensions/pi-teams/team-node-runner.js", () => ({
	participantsFromRuns: (runs: Array<{ output: string; model: string; ok: boolean; durationMs: number; error?: string }>) => runs.map((run) => ({
		member: { label: "mock", model: run.model },
		prompt: "",
		systemPrompt: "",
		output: run.output,
		durationMs: run.durationMs,
		ok: run.ok,
		...(run.error ? { error: run.error } : {}),
	})),
	nodeDetails: (nodes: Array<{ role: string; model: string; ok: boolean; durationMs: number; attempts: number; error?: string }>) => nodes.map((node) => ({
		role: node.role,
		model: node.model,
		ok: node.ok,
		durationMs: node.durationMs,
		attempts: node.attempts,
		...(node.error ? { error: node.error } : {}),
	})),
	runTeamNode: async (args: { role: string; binding: TeamAgentBinding; model: string }) => {
		callRoles.push(args.role);
		if (stopAfterRole === args.role) {
			activeStateManager.requestStop(activeRunId, `stop after ${args.role}`);
		}
		return {
			role: args.role,
			binding: args.binding,
			model: args.model,
			ok: true,
			output: args.role.startsWith("verifier") ? "critical gap remains" : `output from ${args.role}`,
			durationMs: 1,
			attempts: 1,
		};
	},
}));

const { getTeamHandler } = await import("../extensions/pi-teams/team-handlers.js");

function researchTeam(): TeamSpec {
	return {
		schemaVersion: 2,
		id: "deep-research-test",
		name: "Deep Research Test",
		protocol: "research",
		prompts: {},
		agents: ["explorer", "verifier", "synthesis"],
		agentBindings: [
			{ role: "explorer", subagent: "explorer", model: "test/explorer" },
			{ role: "verifier", subagent: "verifier", model: "test/verifier" },
			{ role: "synthesis", subagent: "synthesis", model: "test/synthesis" },
		],
		models: { members: ["test/explorer", "test/verifier"], synthesis: "test/synthesis" },
		limits: { maxLoops: 2 },
		source: "builtin",
		path: "deep-research-test.md",
	};
}

function fakeCtx() {
	return {
		cwd: process.cwd(),
		ui: { setStatus() {} },
	};
}

async function runResearchWithStop(stopRole?: string) {
	callRoles.length = 0;
	stopAfterRole = stopRole;
	activeEntries = [];
	activeStateManager = new TeamStateManager({ appendEntry: (customType, data) => activeEntries.push({ type: "custom", customType, data }) });
	activeRunId = activeStateManager.startRun({ teamId: "deep-research-test", protocol: "research", prompt: "test prompt" });
	activeStateManager.rehydrateFromSession({ getEntries: () => activeEntries });
	const handler = getTeamHandler(researchTeam());
	if (!handler) throw new Error("research handler missing");
	return handler.run({
		team: researchTeam(),
		params: { id: "deep-research-test", prompt: "test prompt" },
		ctx: fakeCtx() as never,
		stateManager: activeStateManager,
		runId: activeRunId,
		signal: new AbortController().signal,
	});
}

describe("research protocol stop boundaries", () => {
	it("stops before starting when a stop is already requested", async () => {
		callRoles.length = 0;
		activeEntries = [];
		activeStateManager = new TeamStateManager({ appendEntry: (customType, data) => activeEntries.push({ type: "custom", customType, data }) });
		activeRunId = activeStateManager.startRun({ teamId: "deep-research-test", protocol: "research", prompt: "test prompt" });
		activeStateManager.rehydrateFromSession({ getEntries: () => activeEntries });
		activeStateManager.requestStop(activeRunId, "pre-start stop");
		const handler = getTeamHandler(researchTeam());
		if (!handler) throw new Error("research handler missing");

		const result = await handler.run({
			team: researchTeam(),
			params: { id: "deep-research-test", prompt: "test prompt" },
			ctx: fakeCtx() as never,
			stateManager: activeStateManager,
			runId: activeRunId,
			signal: new AbortController().signal,
		});

		expect(result.details).toMatchObject({ stopped: true, reason: "pre-start stop" });
		expect(callRoles).toEqual([]);
	});

	it("stops between Explorer and Verifier", async () => {
		const result = await runResearchWithStop("explorer_1");

		expect(result.details).toMatchObject({ stopped: true, reason: "stop after explorer_1" });
		expect(callRoles).toEqual(["explorer_1"]);
	});

	it("stops before the next Explorer loop", async () => {
		const result = await runResearchWithStop("verifier_1");

		expect(result.details).toMatchObject({ stopped: true, reason: "stop after verifier_1" });
		expect(callRoles).toEqual(["explorer_1", "verifier_1"]);
	});
});
