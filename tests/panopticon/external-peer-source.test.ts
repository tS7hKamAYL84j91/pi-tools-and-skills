/** External peer refresh is fresh, operator-scoped and fail-closed. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupExternalPeerSource } from "../../extensions/pi-panopticon/registry/external-peer-source.js";
import { asExtensionApi, makeAgentRecord, makeMockExtensionApi, makeRegistry } from "./helpers.js";

const load = vi.hoisted(() => vi.fn());
vi.mock("../../extensions/pi-panopticon/registry/external-registrar.js", () => ({ loadExternalAgents: load }));
afterEach(() => { vi.unstubAllEnvs(); load.mockReset(); });

function fixture() {
	const api = makeMockExtensionApi();
	const registry = makeRegistry(makeAgentRecord());
	setupExternalPeerSource(asExtensionApi(api), registry);
	const handler = api.eventHandlers.get("tool_call")?.[0] as unknown as (event: { toolName: string }, ctx: { cwd: string }) => Promise<void>;
	return { registry, call: (toolName: string) => handler({ toolName }, { cwd: "/local-project" }) };
}

describe("external peer source", () => {
	it("refreshes on every peer tool using the operator's shared source", async () => {
		vi.stubEnv("PI_PANOPTICON_EXTERNAL_WORKSPACE_ROOT", "/shared");
		vi.stubEnv("PI_PANOPTICON_EXTERNAL_MAILBOX_ROOT", "/mail");
		const { registry, call } = fixture();
		const peer = makeAgentRecord({ kind: "external", id: "ext-test" });
		load.mockResolvedValueOnce([peer]).mockResolvedValueOnce([]);
		await call("agent_peek");
		expect(registry.setExternalPeers).toHaveBeenLastCalledWith([peer]);
		await call("agent_send");
		expect(registry.setExternalPeers).toHaveBeenLastCalledWith([]);
		expect(load).toHaveBeenCalledTimes(2);
		expect(load).toHaveBeenLastCalledWith({ workspaceRoot: "/shared", mailboxRoot: "/mail" });
	});

	it("clears stale peers and fails before tool execution when validation fails", async () => {
		const { registry, call } = fixture();
		load.mockRejectedValue(new Error("invalid manifest"));
		await expect(call("agent_broadcast")).rejects.toThrow("invalid manifest");
		expect(registry.setExternalPeers).toHaveBeenCalledExactlyOnceWith([]);
	});

	it("does not let manifest failures block inbox reads or unrelated tools", async () => {
		const { call } = fixture();
		load.mockRejectedValue(new Error("invalid manifest"));
		await call("message_read");
		await call("read");
		expect(load).not.toHaveBeenCalled();
	});
});
