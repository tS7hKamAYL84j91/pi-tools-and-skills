/** Real HTTP MCP clients must remain bound to their authenticated identity. */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { parseFleetConfig } from "../fleet-mcp/config.js";
import { FleetGateway } from "../fleet-mcp/gateway.js";
import { startHttp } from "../fleet-mcp/server.js";

const configuration = {
	transport: "http", workspaceAlias: "test", workspaceRoot: "/test/workspace",
	mailboxRoot: "/test/mail", stateDir: "/test/state",
};

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
	return CallToolResultSchema.parse(await client.callTool({ name, arguments: { workspace: "test", ...args } }));
}

function errorCode(result: Awaited<ReturnType<typeof call>>): string | undefined {
	if (!result.isError) return undefined;
	const content = result.content as Array<{ type: string; text?: string }>;
	return JSON.parse(content[0]?.text ?? "{}").code as string | undefined;
}

describe("Fleet MCP HTTP identities", () => {
	it("rejects empty, duplicate and ambiguous identity maps without echoing credentials", () => {
		const token = randomBytes(24).toString("hex");
		const first = { principal: "alpha", bearerToken: token };
		for (const httpPrincipals of [[], [first, first], [first, { ...first, principal: "beta" }], [{ ...first, unexpected: true }]]) {
			expect(() => parseFleetConfig({ ...configuration, httpPrincipals })).toThrow();
		}
		expect(() => parseFleetConfig({ ...configuration, httpPrincipals: [first], bearerToken: token })).toThrow("Ambiguous");
		expect(() => parseFleetConfig({ ...configuration, nativeAgentId: "../escape", httpPrincipals: [first] })).toThrow("Invalid nativeAgentId");
	});

	it("registers, exchanges messages, denies cross-owner mutations and persists both identities", async () => {
		const root = await mkdtemp(join(tmpdir(), "fleet-http-auth-"));
		const identities = ["alpha", "beta"].map((principal) => ({ principal, bearerToken: randomBytes(24).toString("hex") }));
		const config = { ...parseFleetConfig({ ...configuration, workspaceRoot: join(root, "workspace"), mailboxRoot: join(root, "mail"), stateDir: join(root, "state"), httpPrincipals: identities }), listenPort: 0 };
		const gateway = new FleetGateway(config);
		await gateway.init();
		const server = await startHttp(config, gateway);
		const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
		const clients: Client[] = [];
		try {
			for (const identity of identities) {
				const client = new Client({ name: identity.principal, version: "1.0.0" });
				clients.push(client);
				await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${identity.bearerToken}` } } }));
			}
			const [alpha, beta] = clients;
			if (!alpha || !beta) throw new Error("missing clients");
			const registered = await Promise.all(clients.map((client, i) => call(client, "fleet_register_external", { display_name: identities[i]?.principal })));
			const [a, b] = registered.map((result) => (result.structuredContent?.result as { agent_id: string }).agent_id);
			expect(a).toMatch(/^ext-/);
			expect(b).not.toBe(a);
			const sent = await call(alpha, "fleet_send", { recipient_id: b, text: "synthetic hello", idempotency_key: "one" });
			expect(sent.isError).not.toBe(true);
			const receipt = sent.structuredContent?.result as { message_id: string };
			expect((await call(beta, "fleet_inbox")).structuredContent?.result).toEqual([expect.objectContaining({ sender_id: a, text: "synthetic hello" })]);
			expect((await call(alpha, "fleet_ack", { message_ids: [receipt.message_id] })).structuredContent?.result).toEqual([{ message_id: receipt.message_id, acknowledged: false }]);
			expect(errorCode(await call(alpha, "fleet_unregister_external", { agent_id: b }))).toBe("FORBIDDEN");
			expect((await call(beta, "fleet_ack", { message_ids: [receipt.message_id] })).structuredContent?.result).toEqual([{ message_id: receipt.message_id, acknowledged: true }]);
			expect((await call(beta, "fleet_inbox")).structuredContent?.result).toEqual([]);
			const restarted = new FleetGateway(config);
			await restarted.init();
			expect(await restarted.forPrincipal("alpha").register("test", "alpha")).toEqual({ agent_id: a });
			expect(await restarted.forPrincipal("beta").register("test", "beta")).toEqual({ agent_id: b });
			expect((await restarted.forPrincipal("alpha").send("test", b ?? "", "synthetic hello", "one")).message_id).toBe(receipt.message_id);
			await call(alpha, "fleet_unregister_external", { agent_id: a });
			expect(errorCode(await call(alpha, "fleet_send", { recipient_id: b, text: "no owner", idempotency_key: "two" }))).toBe("UNAUTHENTICATED");
			const nextRegistration = await call(alpha, "fleet_register_external", { display_name: "alpha" });
			expect((nextRegistration.structuredContent?.result as { agent_id: string }).agent_id).not.toBe(a);
			const nextSend = await call(alpha, "fleet_send", { recipient_id: b, text: "synthetic hello", idempotency_key: "one" });
			expect((nextSend.structuredContent?.result as { message_id: string }).message_id).not.toBe(receipt.message_id);
		} finally {
			await Promise.all(clients.map((client) => client.close()));
			await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
			await rm(root, { recursive: true, force: true });
		}
	});
});
