import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { parseFleetConfig, type FleetConfig } from "../fleet-mcp/config.js";
import { FleetError, FleetGateway } from "../fleet-mcp/gateway.js";
import { createMcpServer, startHttp } from "../fleet-mcp/server.js";

const dirs: string[] = [];

async function workspace(): Promise<{ root: string; config(principal: string): FleetConfig }> {
	const root = await mkdtemp(join(tmpdir(), "fleet-mcp-"));
	dirs.push(root);
	return {
		root,
		config(principal: string) {
			return parseFleetConfig({
				workspaceAlias: "test",
				workspaceRoot: join(root, "workspace"),
				mailboxRoot: join(root, "mail"),
				stateDir: join(root, `state-${principal}`),
				transport: "stdio",
				principal,
			});
		},
	};
}

async function gateway(config: FleetConfig): Promise<FleetGateway> {
	const result = new FleetGateway(config);
	await result.init();
	return result;
}

afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("fleet MCP architecture", () => {
	it("rejects unsafe and unknown HTTP configuration", () => {
		expect(() =>
			parseFleetConfig({
				workspaceAlias: "x",
				workspaceRoot: "/x",
				mailboxRoot: "/m",
				stateDir: "/s",
				transport: "http",
				bearerToken: "short",
			}),
		).toThrow(/bearerToken/);
		expect(() =>
			parseFleetConfig({
				workspaceAlias: "x",
				workspaceRoot: "/x",
				mailboxRoot: "/m",
				stateDir: "/s",
				unexpected: true,
			}),
		).toThrow(/Unknown configuration property/);
	});

	it("uses configured principals rather than caller-selected identities", async () => {
		const shared = await workspace();
		const alpha = await gateway(shared.config("alpha-client"));
		const beta = await gateway(shared.config("beta-client"));
		const a = await alpha.register("test", "alpha");
		const b = await beta.register("test", "beta");
		expect(await alpha.register("test", "alpha")).toEqual(a);
		await expect(alpha.register("test", "renamed-alpha")).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await alpha.agents("test")).toHaveLength(2);

		const receipt = await alpha.send("test", b.agent_id, "hello", "k1", "c1");
		expect(receipt.state).toBe("accepted");
		expect((await alpha.send("test", b.agent_id, "hello", "k1", "c1")).message_id).toBe(receipt.message_id);
		await expect(alpha.send("test", b.agent_id, "changed", "k1")).rejects.toMatchObject({ code: "CONFLICT" });

		const inbox = await beta.inbox("test");
		expect(inbox).toHaveLength(1);
		const message = inbox[0] as { message_id: string; text: string; truncated: boolean };
		expect(message).toMatchObject({ text: "hello", truncated: false });
		expect(await beta.ack("test", [message.message_id])).toEqual([
			{ message_id: message.message_id, acknowledged: true },
		]);
		expect(await beta.ack("test", [message.message_id])).toEqual([
			{ message_id: message.message_id, acknowledged: true },
		]);
		expect(await beta.inbox("test")).toHaveLength(0);

		await alpha.unregister("test", a.agent_id);
		await alpha.unregister("test", a.agent_id);
	});

	it.each([
		{ text: "hello", limit: 3, expected: "hel", truncated: true },
		{ text: "abc", limit: 3, expected: "abc", truncated: false },
		{ text: "éé", limit: 3, expected: "é", truncated: true },
		{ text: "é", limit: 1, expected: "", truncated: true },
		{ text: "é", limit: 2, expected: "é", truncated: false },
		{ text: "😀x", limit: 3, expected: "", truncated: true },
		{ text: "😀x", limit: 4, expected: "😀", truncated: true },
		{ text: "😀", limit: 4, expected: "😀", truncated: false },
	])("bounds inbox UTF-8 text: $text at $limit bytes", async ({ text, limit, expected, truncated }) => {
		const shared = await workspace();
		const alpha = await gateway(shared.config("sender"));
		const betaConfig = shared.config("receiver");
		const beta = await gateway({ ...betaConfig, limits: { ...betaConfig.limits, maxTextBytes: limit } });
		await alpha.register("test", "sender");
		const receiver = await beta.register("test", "receiver");
		await alpha.send("test", receiver.agent_id, text, "utf8");
		const [message] = await beta.inbox("test") as Array<{ text: string; truncated: boolean }>;
		expect(message).toMatchObject({ text: expected, truncated });
		expect(Buffer.byteLength(message?.text ?? "", "utf8")).toBeLessThanOrEqual(limit);
		expect(text.startsWith(message?.text ?? "")).toBe(true);
	});

	it("persists receipts safely across restart, including prototype-like principals", async () => {
		const shared = await workspace();
		const alphaConfig = shared.config("__proto__");
		const beta = await gateway(shared.config("constructor"));
		const alpha = await gateway(alphaConfig);
		await alpha.register("test", "alpha");
		const b = await beta.register("test", "beta");
		const receipt = await alpha.send("test", b.agent_id, "once", "durable-key");
		const restarted = await gateway(alphaConfig);
		expect((await restarted.send("test", b.agent_id, "once", "durable-key")).message_id).toBe(receipt.message_id);
		expect(JSON.stringify(new FleetError("INTERNAL"))).not.toContain(shared.root);
	});

	it("publishes strict tools without caller-controlled client identity", async () => {
		const shared = await workspace();
		const config = shared.config("authenticated-principal");
		const serviceGateway = await gateway(config);
		const server = createMcpServer(config, serviceGateway);
		const client = new Client({ name: "fleet-test", version: "1.0.0" });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
		try {
			const tools = await client.listTools();
			const registration = tools.tools.find((tool) => tool.name === "fleet_register_external");
			expect(registration?.inputSchema).toMatchObject({
				additionalProperties: false,
				required: ["workspace", "display_name"],
			});
			expect(JSON.stringify(registration?.inputSchema)).not.toContain("client_key");
			const response = await client.callTool({
				name: "fleet_register_external",
				arguments: { workspace: "test", display_name: "authenticated-agent" },
			});
			expect(response.isError).not.toBe(true);
			expect(response.structuredContent).toHaveProperty("result.agent_id");
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("enforces loopback HTTP auth, methods, parsing, health and readiness", async () => {
		const shared = await workspace();
		const config = {
			...shared.config("http-client"),
			transport: "http" as const,
			bearerToken: "example_token_123",
			listenPort: 0,
		};
		const serviceGateway = await gateway(config);
		const server = await startHttp(config, serviceGateway);
		const port = (server.address() as AddressInfo).port;
		const base = `http://127.0.0.1:${port}`;
		try {
			expect((await fetch(`${base}/healthz`)).status).toBe(200);
			expect((await fetch(`${base}/readyz`)).status).toBe(200);
			expect((await fetch(`${base}/mcp`)).status).toBe(401);
			expect(
				(await fetch(`${base}/mcp`, { headers: { authorization: "Bearer example_token_123" } })).status,
			).toBe(405);
			expect(
				(
					await fetch(`${base}/mcp`, {
						method: "POST",
						headers: { authorization: "Bearer example_token_123" },
						body: "not-json",
					})
				).status,
			).toBe(400);
		} finally {
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		}
	});
});
