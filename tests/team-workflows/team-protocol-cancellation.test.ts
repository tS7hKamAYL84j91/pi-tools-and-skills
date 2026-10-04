import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { TeamSpec } from "../../extensions/pi-team-workflows/team-types.js";
import type { runTeamNode } from "../../extensions/pi-team-workflows/team-node-runner.js";
import { TeamStateManager } from "../../extensions/pi-team-workflows/state.js";

const call = vi.hoisted(() => vi.fn<typeof runTeamNode>());
vi.mock("../../extensions/pi-team-workflows/team-node-runner.js", async original => ({ ...await original<typeof import("../../extensions/pi-team-workflows/team-node-runner.js")>(), runTeamNode: call }));
vi.mock("../../extensions/pi-team-workflows/runner.js", () => ({ currentPanopticonRecord: async () => ({ id: "parent-id", name: "parent-name" }) }));
const { getTeamHandler } = await import("../../extensions/pi-team-workflows/team-handlers.js");
function team(protocol: "consult" | "debate" | "research"): TeamSpec {
	return { schemaVersion: 2, id: "contract", name: "Contract", protocol, prompts: {}, agents: ["fixture"], agentBindings: ["navigator", "member", "critic", "explorer", "verifier", "synthesis"].map(role => ({ role, subagent: "fixture" })), models: { members: ["test/member", "test/verifier"], synthesis: "test/synthesis", navigator: "test/navigator" }, limits: { timeoutMs: 321, maxRetries: 1, maxLoops: 1 }, source: "builtin", path: "fixture" };
}
async function execute(protocol: "consult" | "debate" | "research", stopRole?: string, preAborted = false, explicit = true) {
	const controller = new AbortController();
	if (preAborted) controller.abort();
	call.mockReset();
	call.mockImplementation(async args => {
		if (args.role === stopRole) controller.abort();
		return { role: args.role, binding: args.binding, model: args.model, ok: true, output: "VERIFIED_COMPLETE", durationMs: 1, attempts: 1 };
	});
	const stateManager = new TeamStateManager({ appendEntry() {} });
	const spec = team(protocol);
	const handler = getTeamHandler(spec);
	if (!handler) throw new Error("missing handler");
	const result = await handler.run({ team: spec, params: { id: spec.id, prompt: "fixture", ...(explicit ? { models: { members: ["test/explicit", "test/auditor"], synthesis: "test/final", navigator: "test/review" }, limits: { timeoutMs: 123, maxRetries: 2 } } : {}) }, ctx: { cwd: process.cwd(), ui: { setStatus() {} } } as unknown as ExtensionContext, stateManager, signal: controller.signal });
	return { result, signal: controller.signal };
}
describe("direct protocol cancellation and node context", () => {
	it.each(["consult", "debate", "research"] as const)("%s does not start when pre-cancelled", async protocol => {
		const { result } = await execute(protocol, undefined, true);
		expect(result.details).toMatchObject({ ok: false, stopped: true });
		expect(call).not.toHaveBeenCalled();
	});
	it.each([ ["consult", "navigator"], ["debate", "generation_1"], ["debate", "critique_1"], ["debate", "synthesis"], ["research", "explorer_1"], ["research", "verifier_1"], ["research", "synthesis"] ] as const)("%s stops after %s without starting a later phase", async (protocol, role) => {
		const { result, signal } = await execute(protocol, role);
		expect(result.details).toMatchObject({ ok: false, stopped: true });
		const calls = call.mock.calls.map(([args]) => args);
		for (const args of calls) expect(args).toMatchObject({ signal, parentId: "parent-id", orchestratorName: "parent-name", timeoutMs: 123, maxRetries: 2 });
		const roles = calls.map(args => args.role);
		if (role.startsWith("generation")) expect(roles.every(r => r.startsWith("generation"))).toBe(true);
		if (role.startsWith("critique")) expect(roles).not.toContain("synthesis");
		if (role === "explorer_1") expect(roles).toEqual(["explorer_1"]);
		if (role === "verifier_1") expect(roles).toEqual(["explorer_1", "verifier_1"]);
	});
	it.each(["debate", "research"] as const)("%s preserves manifest limits when explicit limits are absent", async protocol => {
		await execute(protocol, undefined, false, false);
		for (const [args] of call.mock.calls) expect(args).toMatchObject({ timeoutMs: 321, maxRetries: 1 });
	});
});
