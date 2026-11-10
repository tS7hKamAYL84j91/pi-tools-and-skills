import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findCurrentAgentIdentity } from "../../lib/agent-identity.js";
import subagents from "../../extensions/pi-subagents/index.js";
import { gracefulKill, spawnChild, type SpawnedAgent } from "../../extensions/pi-subagents/spawner/spawn-service.js";
import { asExtensionApi, makeMockExtensionApi, toolText } from "../agent-hub/helpers.js";

vi.mock("../../lib/agent-identity.js", () => ({ findCurrentAgentIdentity: vi.fn(() => null) }));
vi.mock("../../extensions/pi-subagents/spawner/spawn-service.js", async (importOriginal) => ({
	...await importOriginal<typeof import("../../extensions/pi-subagents/spawner/spawn-service.js")>(),
	spawnChild: vi.fn(),
	gracefulKill: vi.fn(async () => {}),
}));

let api: ReturnType<typeof makeMockExtensionApi>;
let agent: SpawnedAgent;
const write = vi.fn();

async function fire(event: string, sessionFile = "/tmp/session.jsonl"): Promise<void> {
	for (const handler of api.eventHandlers.get(event) ?? []) {
		await (handler as (event: unknown, ctx: unknown) => Promise<void>)({}, {
			sessionManager: { getSessionFile: () => sessionFile },
		});
	}
}

async function execute(name: string, params: Record<string, unknown>) {
	const tool = api.registeredTools.get(name);
	if (!tool) throw new Error(`${name} not registered`);
	return tool.execute("call", params, new AbortController().signal);
}

async function spawn(name = "worker") {
	return execute("spawn_agent", { name });
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(findCurrentAgentIdentity).mockReturnValue(null);
	write.mockReturnValue(true);
	agent = {
		name: "worker", pid: 1234, cwd: "/tmp", startedAt: Date.now() - 125_000,
		recentEvents: [], emitter: new EventEmitter(), done: false,
		proc: { stdin: { writable: true, write }, exitCode: 0 } as unknown as ChildProcess,
	};
	vi.mocked(spawnChild).mockReturnValue(agent);
	api = makeMockExtensionApi();
	subagents(asExtensionApi(api));
});

afterEach(() => { vi.unstubAllEnvs(); });

describe("standalone Subagents", () => {
	it("registers only the four worker tools without messaging or registry setup", () => {
		expect([...api.registeredTools.keys()].sort()).toEqual(["kill_agent", "list_spawned", "rpc_send", "spawn_agent"]);
		expect(api.registeredCommands.size).toBe(0);
		expect(spawnChild).not.toHaveBeenCalled();
	});

	it("spawns without Agent Hub and uses a stable fallback parent identity", async () => {
		await fire("session_start");
		const result = await spawn();
		const firstEnv = vi.mocked(spawnChild).mock.calls[0]?.[0].env;
		await spawn("worker-2");
		expect(toolText(result)).toContain('Spawned "worker"');
		expect(firstEnv?.PI_PANOPTICON_PARENT_ID).toMatch(new RegExp(`^${process.pid}-`));
		expect(vi.mocked(spawnChild).mock.calls[1]?.[0].env?.PI_PANOPTICON_PARENT_ID).toBe(firstEnv?.PI_PANOPTICON_PARENT_ID);
		expect(firstEnv).toMatchObject({ PI_PANOPTICON_SPAWN_NAME: "worker", PI_PANOPTICON_SCOPE: "task", PI_PANOPTICON_VISIBILITY: "scoped" });
	});

	it("starts a supplied task immediately without a separate RPC call", async () => {
		await execute("spawn_agent", { name: "worker", task: "Inspect the branch" });
		expect(write).toHaveBeenCalledOnce();
		expect(JSON.parse(write.mock.calls[0]?.[0] as string)).toEqual({ type: "prompt", message: "Inspect the branch" });
	});

	it("preserves inherited namespace when Agent Hub is absent", async () => {
		vi.stubEnv("PI_PANOPTICON_NAMESPACE", "original-lead");
		await spawn();
		expect(vi.mocked(spawnChild).mock.calls[0]?.[0].env?.PI_PANOPTICON_NAMESPACE).toBe("original-lead");
	});

	it("queries optional Hub identity at spawn time, preserving declared lead and nested namespace", async () => {
		await fire("session_start");
		vi.mocked(findCurrentAgentIdentity).mockReturnValue({ id: "hub-parent", name: "alias", declared_name: "lead" });
		await spawn();
		expect(findCurrentAgentIdentity).toHaveBeenCalledWith("/tmp/session.jsonl");
		expect(vi.mocked(spawnChild).mock.calls[0]?.[0].env).toMatchObject({ PI_PANOPTICON_PARENT_ID: "hub-parent", PI_PANOPTICON_NAMESPACE: "lead" });
		vi.mocked(findCurrentAgentIdentity).mockReturnValue({ id: "hub-parent", name: "renamed", namespace: "original-lead" });
		await spawn("worker-2");
		expect(vi.mocked(spawnChild).mock.calls[1]?.[0].env?.PI_PANOPTICON_NAMESPACE).toBe("original-lead");
	});

	it("supports direct RPC, output inspection, and removal without Agent Hub", async () => {
		await spawn();
		write.mockImplementation((line: string) => {
			const request = JSON.parse(line) as { type: string; id: string };
			agent.emitter.emit("line", JSON.stringify({ type: "response", command: request.type, id: request.id, success: true, data: { isStreaming: false } }));
			return true;
		});
		expect(toolText(await execute("rpc_send", { name: "worker", command: "get_state" }))).toContain('RPC get_state → "worker"');
		expect(toolText(await execute("list_spawned", { name: "worker" }))).toContain('Agent "worker"');
		await execute("kill_agent", { name: "worker" });
		expect(agent.expectedExit).toBe(true);
		expect(gracefulKill).toHaveBeenCalledOnce();
		expect(toolText(await execute("list_spawned", {}))).toBe("No agents spawned in this session.");
	});

	it("sends the missing-completion follow-up without requiring peer messaging", async () => {
		await spawn();
		agent.emitter.emit("line", JSON.stringify({ type: "process_exit" }));
		expect(api.sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining('Agent "worker" (pid 1234) exited (code 0) after 2m without sending a completion signal'),
			{ deliverAs: "followUp" },
		);
	});

	it("owns child shutdown, marks deliberate exits expected, and suppresses warnings", async () => {
		await spawn();
		await fire("session_shutdown");
		await fire("session_shutdown");
		expect(gracefulKill).toHaveBeenCalledOnce();
		expect(agent.expectedExit).toBe(true);
		expect(gracefulKill).toHaveBeenCalledWith(agent, expect.any(Function));
		agent.emitter.emit("line", JSON.stringify({ type: "process_exit" }));
		expect(api.sendUserMessage).not.toHaveBeenCalled();
	});
});
