import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { parseFleetConfig } from "../fleet-mcp/config.js";
import { FleetGateway, FleetError } from "../fleet-mcp/gateway.js";

const dirs: string[] = [];
async function setup() { const root = await mkdtemp(join(tmpdir(), "fleet-mcp-")); dirs.push(root); const config = parseFleetConfig({ workspaceAlias: "test", workspaceRoot: join(root, "workspace"), mailboxRoot: join(root, "mail"), stateDir: join(root, "state"), transport: "stdio" }); const gateway = new FleetGateway(config); await gateway.init(); return { gateway, config }; }
afterEach(async () => { const pending = dirs.splice(0); for (const dir of pending) await rm(dir, { recursive: true, force: true }); });

describe("fleet MCP vertical slice", () => {
  it("rejects unsafe HTTP config and defaults to loopback", () => { expect(() => parseFleetConfig({ workspaceAlias: "x", workspaceRoot: "/x", mailboxRoot: "/m", stateDir: "/s", transport: "http", bearerToken: "short" })).toThrow(/bearerToken/); const c = parseFleetConfig({ workspaceAlias: "x", workspaceRoot: "/x", mailboxRoot: "/m", stateDir: "/s" }); expect(c.listenHost).toBe("127.0.0.1"); });
  it("registers, sends, reads, acknowledges, and unregisters", async () => { const { gateway } = await setup(); const a = await gateway.register("test", "a", "alpha"); const b = await gateway.register("test", "b", "beta"); expect((await gateway.agents("test"))).toHaveLength(2); const receipt = await gateway.send("test", "a", b.agent_id, "hello", "k1", "c1"); expect(receipt.state).toBe("accepted"); expect((await gateway.send("test", "a", b.agent_id, "hello", "k1", "c1")).message_id).toBe(receipt.message_id); const inbox = await gateway.inbox("test", "b"); expect(inbox).toHaveLength(1); expect((inbox[0] as { text: string }).text).toBe("hello"); await gateway.ack("test", "b", [(inbox[0] as { message_id: string }).message_id]); expect(await gateway.inbox("test", "b")).toHaveLength(0); await gateway.unregister("test", "a", a.agent_id); });
  it("does not leak conflicts as payload errors", async () => { const { gateway } = await setup(); await gateway.register("test", "a", "alpha"); const b = await gateway.register("test", "b", "beta"); await gateway.send("test", "a", b.agent_id, "one", "same"); await expect(gateway.send("test", "a", b.agent_id, "two", "same")).rejects.toMatchObject({ code: "CONFLICT" } satisfies Partial<FleetError>); expect(JSON.stringify(new FleetError("INTERNAL"))).not.toContain("/tmp"); });
});
