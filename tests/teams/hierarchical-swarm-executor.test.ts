import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TeamStateManager } from "../../extensions/pi-teams/state.js";
import type { TeamAgentBinding, TeamSpec } from "../../extensions/pi-teams/team-types.js";

const calls: Array<{ role: string; nodeId?: string; parentId?: string; orchestratorName?: string; prompt: string }> = [];
let rootDelegatedPrompt = "coordinate";

vi.mock("../../extensions/pi-teams/team-node-runner.js", async () => {
	const actual = await vi.importActual<typeof import("../../extensions/pi-teams/team-node-runner.js")>("../../extensions/pi-teams/team-node-runner.js");
	return {
		...actual,
		runTeamNode: async (args: { role: string; nodeId?: string; parentId?: string; orchestratorName?: string; binding: TeamAgentBinding; model: string; prompt: string }) => {
			calls.push(args);
			const output = args.role === "root" && !args.prompt.includes("Review these")
				? `\`\`\`json\n{"children":[{"role":"manager","prompt":${JSON.stringify(rootDelegatedPrompt)}}]}\n\`\`\``
				: args.role === "manager" && !args.prompt.includes("Review these")
					? "```json\n{\"children\":[{\"role\":\"worker\",\"prompt\":\"implement\"}]}\n```"
					: args.role === "worker" ? "artifact" : `${args.role} review`;
			return { role: args.role, binding: args.binding, model: args.model, ok: true, output, durationMs: 1, attempts: 1 };
		},
	};
});

const { hierarchicalSwarmHandler } = await import("../../extensions/pi-teams/team-handler-hierarchical-swarm.js");

function team(): TeamSpec {
	return {
		schemaVersion: 2, id: "tree", name: "Tree", protocol: "hierarchical-swarm", prompts: {}, agents: ["agent"], models: {}, limits: {}, source: "builtin", path: "tree.md",
		agentBindings: [
			{ role: "root", subagent: "agent", model: "test/root" },
			{ role: "manager", subagent: "agent", model: "test/manager" },
			{ role: "worker", subagent: "agent", model: "test/worker" },
		],
		hierarchicalSwarm: {
			roleTemplates: [
				{ role: "root", bindingRole: "root", review: { reviewerRole: "root", required: true } },
				{ role: "manager", bindingRole: "manager", review: { reviewerRole: "root", required: true } },
				{ role: "worker", bindingRole: "worker", review: { reviewerRole: "manager", required: true } },
			],
			bounds: { maxDepth: 2, maxChildrenPerNode: 2, maxTotalNodes: 3, maxWip: 1, ttlMs: 1_000, writeIsolation: { mode: "tree-global-exclusive" } },
		},
	};
}

describe("hierarchical swarm executor", () => {
	it("uses tree-path ids, denies worker spawning, and reviews each subtree", async () => {
		calls.length = 0;
		const stateManager = new TeamStateManager();
		const spec = team();
		const runId = stateManager.startRun({ teamId: spec.id, protocol: spec.protocol, prompt: "task" });
		const result = await hierarchicalSwarmHandler.run({
			team: spec, params: { id: spec.id, prompt: "task" }, stateManager, runId,
			ctx: { cwd: process.cwd(), ui: { setStatus() {} } } as never,
		});
		expect(result.content[0]?.text).toBe("root review");
		expect(calls.map((call) => `${call.role}:${call.nodeId}`)).toEqual(["root:root", "manager:root.1", "worker:root.1.1", "manager:root.1", "root:root"]);
		expect(calls[1]).toMatchObject({ parentId: "root", orchestratorName: "root" });
		expect(calls[2]).toMatchObject({ parentId: "root.1", orchestratorName: "root.1" });
		const run = stateManager.get(runId);
		expect(run?.nodes.map((node) => node.nodeId).sort()).toEqual(["root", "root.1", "root.1.1"]);
		expect(run?.details.find((detail) => detail.nodeId === "root.1" && detail.message === "hierarchical child created")?.data).toMatchObject({ parentId: "root", inheritedWip: 1 });
	});

	it("classifies the complete delegated child brief before model eligibility", async () => {
		calls.length = 0;
		rootDelegatedPrompt = "workspace-private delegated detail";
		const cwd = mkdtempSync(join(tmpdir(), "hierarchical-swarm-private-"));
		try {
			mkdirSync(join(cwd, ".pi"));
			writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({
				coasProfile: {
					localOnlyTriggers: ["workspace-private"],
					modelRoutingPolicy: { requiresLocalOnlyForPrivateInput: true },
				},
			}), "utf8");
			const stateManager = new TeamStateManager();
			const spec = team();
			const runId = stateManager.startRun({ teamId: spec.id, protocol: spec.protocol, prompt: "public task" });
			await hierarchicalSwarmHandler.run({
				team: spec, params: { id: spec.id, prompt: "public task" }, stateManager, runId,
				ctx: { cwd, ui: { setStatus() {} } } as never,
			});
			expect(calls.map((call) => call.role)).toEqual(["root"]);
			expect(stateManager.get(runId)?.details.find((detail) => detail.nodeId === "root.1" && detail.message === "child model eligibility escalation")?.data).toMatchObject({ classification: "private" });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			rootDelegatedPrompt = "coordinate";
		}
	});
});
