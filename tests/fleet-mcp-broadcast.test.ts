/** Durable broadcast snapshots, retries and registration generations. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseFleetConfig } from "../fleet-mcp/config.js";
import { DirectMaildirBackend } from "../fleet-mcp/backend.js";
import { FleetGateway } from "../fleet-mcp/gateway.js";

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "fleet-broadcast-"));
	const config = parseFleetConfig({ workspaceAlias: "test", workspaceRoot: join(root, "workspace"), mailboxRoot: join(root, "mail"), stateDir: join(root, "state"), principal: "alpha" });
	const backend = new DirectMaildirBackend(config);
	const alpha = new FleetGateway(config, { backend });
	await alpha.init();
	await alpha.register("test", "alpha");
	const beta = alpha.forPrincipal("beta");
	const b = await beta.register("test", "beta");
	return { root, config, backend, alpha, beta, b };
}

describe("Fleet broadcast", () => {
	it("persists partial results and retries only failed snapshot targets across restart", async () => {
		const { root, config, backend, alpha, beta, b } = await fixture();
		try {
			const charlie = alpha.forPrincipal("charlie");
			const c = await charlie.register("test", "charlie");
			const deliver = backend.send.bind(backend);
			const send = vi.spyOn(backend, "send").mockImplementation(async (owner, recipient, text) => recipient.id === b.agent_id ? { accepted: false } : deliver(owner, recipient, text));
			const first = await alpha.broadcast("test", "synthetic broadcast", "batch-1");
			expect(first.state).toBe("partial");
			expect(first.targets.sort()).toEqual([b.agent_id, c.agent_id].sort());
			expect(first.results).toEqual(expect.arrayContaining([expect.objectContaining({ recipient_id: b.agent_id, error: { code: "BACKEND_UNAVAILABLE", retryable: true } })]));
			expect(await alpha.inbox("test")).toEqual([]);
			const newcomer = alpha.forPrincipal("newcomer");
			await newcomer.register("test", "newcomer");
			send.mockImplementation(deliver);
			const restarted = new FleetGateway(config, { backend });
			await restarted.init();
			const second = await restarted.broadcast("test", "synthetic broadcast", "batch-1");
			expect(second.state).toBe("complete");
			expect(second.targets).toEqual(first.targets);
			expect(send).toHaveBeenCalledTimes(3);
			expect(await beta.inbox("test")).toHaveLength(1);
			expect(await charlie.inbox("test")).toHaveLength(1);
			expect(await newcomer.inbox("test")).toEqual([]);
			expect(await restarted.broadcast("test", "synthetic broadcast", "batch-1")).toEqual(second);
			expect(send).toHaveBeenCalledTimes(3);
			await expect(restarted.broadcast("test", "different text", "batch-1")).rejects.toMatchObject({ code: "CONFLICT" });
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("isolates broadcast keys by identity and registration generation", async () => {
		const { root, alpha, beta, b } = await fixture();
		try {
			await alpha.broadcast("test", "one", "shared-key");
			await beta.broadcast("test", "two", "shared-key");
			expect(await alpha.inbox("test")).toHaveLength(1);
			await beta.unregister("test", b.agent_id);
			await expect(beta.broadcast("test", "two", "shared-key")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
			await beta.register("test", "beta");
			await beta.broadcast("test", "two", "shared-key");
			expect(await alpha.inbox("test")).toHaveLength(2);
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("refuses oversized snapshots before sending and supports a bounded filter", async () => {
		const { root, backend, alpha } = await fixture();
		try {
			const peers = await backend.agents();
			const base = peers[0];
			if (!base) throw new Error("fixture missing");
			vi.spyOn(backend, "agents").mockResolvedValue([...peers, ...Array.from({ length: 101 }, (_, i) => ({ ...base, id: `extra-${i}`, name: `extra-${i}` }))]);
			const send = vi.spyOn(backend, "send");
			await expect(alpha.broadcast("test", "synthetic", "too-many")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
			expect(send).not.toHaveBeenCalled();
			const filtered = await alpha.broadcast("test", "synthetic", "filtered", "beta");
			expect(filtered.targets).toHaveLength(1);
			expect(filtered.state).toBe("complete");
		} finally { await rm(root, { recursive: true, force: true }); }
	});
});
