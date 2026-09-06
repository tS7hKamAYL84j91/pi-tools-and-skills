/** State compatibility and fail-closed restart behavior. */
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFleetConfig } from "../fleet-mcp/config.js";
import { FleetGateway } from "../fleet-mcp/gateway.js";

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "fleet-state-"));
	const config = parseFleetConfig({ workspaceAlias: "test", workspaceRoot: join(root, "workspace"), mailboxRoot: join(root, "mail"), stateDir: join(root, "state"), principal: "alpha" });
	const gateway = new FleetGateway(config);
	await gateway.init();
	return { root, config, gateway, statePath: join(config.stateDir, "state.json") };
}

describe("Fleet state compatibility", () => {
	it("migrates version 1 receipts and acknowledgements to the existing registration generation", async () => {
		const { root, config, gateway, statePath } = await fixture();
		try {
			const a = await gateway.register("test", "alpha");
			const beta = gateway.forPrincipal("beta");
			const b = await beta.register("test", "beta");
			const receipt = await gateway.send("test", b.agent_id, "synthetic", "old-key");
			await beta.ack("test", [receipt.message_id]);
			await writeFile(statePath, JSON.stringify({
				version: 1,
				registrations: [{ principal: "alpha", agentId: a.agent_id, displayName: "alpha" }, { principal: "beta", agentId: b.agent_id, displayName: "beta" }],
				idempotency: [{ principalKey: JSON.stringify(["alpha", "old-key"]), fingerprint: JSON.stringify([b.agent_id, "synthetic", null]), receipt }],
				acknowledged: [{ principal: "beta", messageIds: [receipt.message_id] }], unregistered: [],
			}));
			const restarted = new FleetGateway(config);
			await restarted.init();
			expect(await restarted.send("test", b.agent_id, "synthetic", "old-key")).toEqual(receipt);
			const restartedBeta = restarted.forPrincipal("beta");
			expect(await restartedBeta.ack("test", [receipt.message_id])).toEqual([{ message_id: receipt.message_id, acknowledged: true }]);
			await restartedBeta.unregister("test", b.agent_id);
			await restartedBeta.register("test", "beta");
			expect(await restartedBeta.ack("test", [receipt.message_id])).toEqual([{ message_id: receipt.message_id, acknowledged: false }]);
			expect(JSON.parse(await readFile(statePath, "utf8")).version).toBe(2);
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("rejects state symlinks without reading or replacing their target", async () => {
		const { root, config, statePath } = await fixture();
		try {
			const target = join(root, "unrelated.json");
			await writeFile(target, "unrelated content", { mode: 0o600 });
			await symlink(target, statePath);
			await expect(new FleetGateway(config).init()).rejects.toMatchObject({ code: "INTERNAL" });
			expect(await readFile(target, "utf8")).toBe("unrelated content");
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("rejects permissive state directories without changing permissions", async () => {
		const { root, config } = await fixture();
		try {
			await chmod(config.stateDir, 0o755);
			await expect(new FleetGateway(config).init()).rejects.toMatchObject({ code: "INTERNAL" });
			expect((await stat(config.stateDir)).mode & 0o777).toBe(0o755);
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it.each(["not-json", '{"version":999}'])("preserves unreadable or unsupported state without resetting ownership", async (content) => {
		const { root, config, statePath } = await fixture();
		try {
			await writeFile(statePath, content, { mode: 0o600 });
			await expect(new FleetGateway(config).init()).rejects.toMatchObject({ code: "INTERNAL" });
			expect(await readFile(statePath, "utf8")).toBe(content);
		} finally { await rm(root, { recursive: true, force: true }); }
	});
});
