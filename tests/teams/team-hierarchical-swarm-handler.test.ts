import { describe, expect, it, vi } from "vitest";
import { TeamStateManager } from "../../extensions/pi-teams/state.js";
import type {
	TeamAgentBinding,
	TeamSpec,
} from "../../extensions/pi-teams/team-types.js";

interface CapturedNodeArgs {
	binding: TeamAgentBinding;
	role: string;
	model: string;
	prompt: string;
	systemPrompt: string;
	timeoutMs?: number;
	maxRetries?: number;
	signal?: AbortSignal;
}

let captured: CapturedNodeArgs | undefined;

vi.mock("../../extensions/pi-teams/team-node-runner.js", async () => {
	const actual = await vi.importActual<
		typeof import("../../extensions/pi-teams/team-node-runner.js")
	>("../../extensions/pi-teams/team-node-runner.js");
	return {
		...actual,
		runTeamNode: async (args: CapturedNodeArgs) => {
			captured = args;
			return {
				role: args.role,
				binding: args.binding,
				model: args.model,
				ok: true,
				output: "root success output",
				durationMs: 1,
				attempts: 1,
			};
		},
	};
});

const { getTeamHandler } = await import(
	"../../extensions/pi-teams/team-handlers.js"
);

function testSwarmTeam(): TeamSpec {
	return {
		schemaVersion: 2,
		id: "swarm-test",
		name: "Swarm Test",
		protocol: "hierarchical-swarm",
		prompts: {},
		agents: ["root_agent"],
		agentBindings: [
			{
				role: "root_orchestrator",
				subagent: "root_agent",
				model: "test/root-model",
				tools: [],
				systemPrompt: "I am root",
			},
		],
		models: {},
		limits: { timeoutMs: 180_000, maxRetries: 4 },
		hierarchicalSwarm: {
			roleTemplates: [
				{
					role: "root",
					bindingRole: "root_orchestrator",
					review: { reviewerRole: "root", required: true },
				},
			],
			bounds: {
				maxDepth: 2,
				maxChildrenPerNode: 3,
				maxTotalNodes: 8,
				maxWip: 3,
				maxRepairCycles: 3,
				ttlMs: 500_000,
				writeIsolation: { mode: "tree-global-exclusive" },
			},
		},
		source: "builtin",
		path: "swarm-test.md",
	};
}

interface TestEntry {
	type: string;
	// biome-ignore lint/suspicious/noExplicitAny: test array
	data: any;
}

async function runHierarchicalSwarm(
	limits?: { timeoutMs?: number; maxRetries?: number },
	signal?: AbortSignal,
) {
	captured = undefined;
	const team = testSwarmTeam();
	const handler = getTeamHandler(team);
	if (!handler) throw new Error("hierarchical-swarm handler missing");

	const entries: TestEntry[] = [];

	const stateManager = new TeamStateManager({
		appendEntry: (type, data) => entries.push({ type, data }),
	});
	const runId = stateManager.startRun({
		teamId: team.id,
		protocol: team.protocol,
		prompt: "do work",
	});

	const result = await handler.run({
		team,
		params: { id: team.id, prompt: "do work", limits },
		ctx: { cwd: process.cwd(), ui: { setStatus() {} } } as never,
		stateManager,
		runId,
		signal,
	});

	return { result, entries };
}

describe("Hierarchical Swarm Handler", () => {
	it("resolves the hierarchical-swarm protocol", () => {
		const team = testSwarmTeam();
		const handler = getTeamHandler(team);
		expect(handler).toBeDefined();
		expect(handler?.key).toBe("hierarchical-swarm");
	});

	it("executes the root node using the root role template and returns a compact ToolResult", async () => {
		const { result, entries } = await runHierarchicalSwarm({
			timeoutMs: 90_000,
			maxRetries: 3,
		});

		expect(captured).toMatchObject({
			role: "root",
			model: "test/root-model",
			prompt: "do work",
			systemPrompt: expect.stringContaining("I am root"),
			timeoutMs: 90_000,
			maxRetries: 3,
		});

		expect(result).toMatchObject({
			content: [{ type: "text", text: "root success output" }],
		});

		expect(result.details?.team).toBe("swarm-test");
		expect(result.details?.ok).toBe(true);

		const phaseStarted = entries.find(
			(e) => e.data.kind === "phase_started",
		);
		expect(phaseStarted).toBeDefined();
		expect(phaseStarted?.data.phaseId).toBe("tree");

		const nodeStarted = entries.find((e) => e.data.kind === "node_started");
		expect(nodeStarted).toBeDefined();
		expect(nodeStarted?.data.role).toBe("root_orchestrator");
		expect(nodeStarted?.data.model).toBe("test/root-model");
	});

	it("propagates cancellation", async () => {
		const controller = new AbortController();

		const runPromise = runHierarchicalSwarm(undefined, controller.signal);

		controller.abort();

		await runPromise;

		expect(captured?.signal).toBe(controller.signal);
	});
});
