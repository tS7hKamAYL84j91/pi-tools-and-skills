import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamAgentBinding } from "../../extensions/pi-panopticon/teams/team-types.js";
import type { ModelRun, TeamParticipant } from "../../extensions/pi-panopticon/teams/types.js";

interface RunMemberArgs {
	prompt: string;
	systemPrompt: string;
	cwd: string;
	signal?: AbortSignal;
	parentId?: string;
}

type RunMemberMock = (member: TeamParticipant, args: RunMemberArgs) => Promise<ModelRun>;
type RunLiveAgentNodeMock = (args: {
	binding: TeamAgentBinding;
	model: string;
	prompt: string;
	systemPrompt: string;
	signal: AbortSignal;
	parentId?: string;
	orchestratorName?: string;
}) => Promise<ModelRun>;

const runMemberMock = vi.hoisted(() => vi.fn<RunMemberMock>());
const runLiveAgentNodeMock = vi.hoisted(() => vi.fn<RunLiveAgentNodeMock>());

vi.mock("../../extensions/pi-panopticon/teams/runner.js", () => ({
	runMember: runMemberMock,
}));

vi.mock("../../extensions/pi-panopticon/teams/live-agent.js", () => ({
	isLiveAgentRef: (value: string) => value.toLowerCase().startsWith("agent:") && value.slice("agent:".length).trim().length > 0,
	liveAgentModel: (value: string) => value === "agent:peer" ? "live/test-model" : undefined,
	runLiveAgentNode: runLiveAgentNodeMock,
}));

const { nodeDetails, runTeamNode } = await import("../../extensions/pi-panopticon/teams/team-node-runner.js");

function fakeCtx(): ExtensionContext {
	return {
		cwd: process.cwd(),
		ui: { setStatus() {} },
	} as unknown as ExtensionContext;
}

function modelRun(args: {
	model: string;
	ok: boolean;
	output?: string;
	error?: string;
}): ModelRun {
	return {
		member: { label: "Member", model: args.model },
		prompt: "prompt",
		systemPrompt: "system",
		output: args.output ?? "",
		durationMs: 1,
		ok: args.ok,
		...(args.error ? { error: args.error } : {}),
	};
}

function nodeArgs(overrides: Partial<Parameters<typeof runTeamNode>[0]> = {}): Parameters<typeof runTeamNode>[0] {
	return {
		binding: { role: "member", subagent: "member_agent", model: "test/model" },
		role: "member",
		model: "test/model",
		prompt: "prompt",
		systemPrompt: "system",
		ctx: fakeCtx(),
		...overrides,
	};
}

describe("team node runtime fallback regressions", () => {
	beforeEach(() => {
		runMemberMock.mockReset();
		runLiveAgentNodeMock.mockReset();
	});

	it("retries a transient provider-unavailable error and reports attempts", async () => {
		runMemberMock
			.mockRejectedValueOnce(new Error("provider unavailable: temporary outage"))
			.mockResolvedValueOnce(modelRun({ model: "test/model", ok: true, output: "recovered" }));

		const result = await runTeamNode(nodeArgs({ maxRetries: 1 }));

		expect(result).toMatchObject({ ok: true, output: "recovered", attempts: 2 });
		expect(runMemberMock).toHaveBeenCalledTimes(2);
	});

	it("preserves clear model-unavailable errors when retry is disabled", async () => {
		runMemberMock.mockResolvedValueOnce(modelRun({
			model: "test/missing-model",
			ok: false,
			error: "model unavailable: test/missing-model",
		}));

		const result = await runTeamNode(nodeArgs({ model: "test/missing-model", maxRetries: 0 }));

		expect(result).toMatchObject({
			ok: false,
			model: "test/missing-model",
			attempts: 1,
			error: "model unavailable: test/missing-model",
		});
		expect(nodeDetails([result])).toEqual([
			expect.objectContaining({
				model: "test/missing-model",
				ok: false,
				attempts: 1,
				error: "model unavailable: test/missing-model",
			}),
		]);
	});

	it("reports exhausted fallback attempts without masking the final node error", async () => {
		runMemberMock.mockRejectedValue(new Error("transient error: provider unavailable"));

		const result = await runTeamNode(nodeArgs({ maxRetries: 2 }));

		expect(result).toMatchObject({
			ok: false,
			attempts: 3,
			error: "transient error: provider unavailable",
		});
		expect(runMemberMock).toHaveBeenCalledTimes(3);
	});

	it("honors binding-level retry fallback for model-backed nodes", async () => {
		runMemberMock
			.mockResolvedValueOnce(modelRun({ model: "test/model", ok: false, error: "transient error: rate limited" }))
			.mockResolvedValueOnce(modelRun({ model: "test/model", ok: true, output: "second attempt" }));

		const result = await runTeamNode(nodeArgs({
			binding: { role: "member", subagent: "member_agent", model: "test/model", maxRetries: 1 },
		}));

		expect(result).toMatchObject({ ok: true, output: "second attempt", attempts: 2 });
		expect(runMemberMock).toHaveBeenCalledTimes(2);
	});

	it("does not retry or model-fallback live-agent nodes", async () => {
		runLiveAgentNodeMock.mockResolvedValueOnce(modelRun({
			model: "live/test-model",
			ok: false,
			error: "live-agent message was not accepted",
		}));

		const result = await runTeamNode(nodeArgs({
			binding: { role: "member", subagent: "agent:peer" },
			model: "live/test-model",
			maxRetries: 3,
		}));

		expect(result).toMatchObject({
			ok: false,
			model: "live/test-model",
			attempts: 1,
			error: "live-agent message was not accepted",
		});
		expect(runLiveAgentNodeMock).toHaveBeenCalledTimes(1);
		expect(runMemberMock).not.toHaveBeenCalled();
	});
});
