import { describe, expect, it, vi } from "vitest";
import { TeamStateManager } from "../../extensions/pi-panopticon/teams/state.js";
import type { TeamAgentBinding, TeamSpec } from "../../extensions/pi-panopticon/teams/team-types.js";

interface CapturedNodeArgs {
	binding: TeamAgentBinding;
	role: string;
	model: string;
	prompt: string;
	systemPrompt: string;
	timeoutMs?: number;
	maxRetries?: number;
}

let captured: CapturedNodeArgs | undefined;

vi.mock("../../extensions/pi-panopticon/teams/team-node-runner.js", async () => {
	const actual = await vi.importActual<typeof import("../../extensions/pi-panopticon/teams/team-node-runner.js")>("../../extensions/pi-panopticon/teams/team-node-runner.js");
	return {
		...actual,
		runTeamNode: async (args: CapturedNodeArgs) => {
			captured = args;
			return { role: args.role, binding: args.binding, model: args.model, ok: true, output: "review", durationMs: 1, attempts: 1 };
		},
	};
});

const { getTeamHandler } = await import("../../extensions/pi-panopticon/teams/team-handlers.js");

function navigatorTeam(): TeamSpec {
	return {
		schemaVersion: 2,
		id: "navigator-profile-test",
		name: "Navigator Profile Test",
		protocol: "consult",
		prompts: {},
		agents: ["navigator"],
		agentBindings: [{ role: "navigator", subagent: "navigator", model: "test/nav", tools: [] }],
		models: { navigator: "test/nav" },
		limits: { timeoutMs: 180_000, maxRetries: 4 },
		source: "builtin",
		path: "navigator-profile-test.md",
	};
}

async function runNavigator(profile: "fast" | "balanced", limits?: { timeoutMs?: number; maxRetries?: number }) {
	captured = undefined;
	const team = navigatorTeam();
	const handler = getTeamHandler(team);
	if (!handler) throw new Error("consult handler missing");
	return handler.run({
		team,
		params: { id: team.id, prompt: "Review this implementation", profile, limits },
		ctx: { cwd: process.cwd(), ui: { setStatus() {} } } as never,
		stateManager: new TeamStateManager({ appendEntry() {} }),
	});
}

describe("Navigator profiles", () => {
	it("uses compact bounded Fast execution with no retries", async () => {
		await runNavigator("fast", { timeoutMs: 90_000, maxRetries: 3 });

		expect(captured).toMatchObject({ timeoutMs: 30_000, maxRetries: 0 });
		expect(captured?.binding.parameters).toMatchObject({ maxTokens: 600 });
		expect(captured?.prompt).toBe("Review briefly. Return only decisive findings and the next action.\n\nReview this implementation");
		expect(captured?.systemPrompt).toBe("Be a concise, skeptical reviewer. Do not restate the request.");
	});

	it("lets explicit Balanced limits override profile defaults", async () => {
		await runNavigator("balanced", { timeoutMs: 45_000, maxRetries: 2 });

		expect(captured).toMatchObject({ timeoutMs: 45_000, maxRetries: 2 });
		expect(captured?.binding.parameters).toMatchObject({ maxTokens: 1_200 });
		expect(captured?.prompt).toContain("Review this implementation");
	});
});
