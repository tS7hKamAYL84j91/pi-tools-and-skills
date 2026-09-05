import { createServer, type Server as HttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod/v4";
import type { FleetConfig } from "./config.js";
import { FleetError } from "./gateway.js";
import type { FleetGateway } from "./gateway.js";

function result(value: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> }; }
export function createMcpServer(_config: FleetConfig, gateway: FleetGateway): McpServer {
  const server = new McpServer({ name: "fleet-mcp", version: "1.0.0" });
  const common = { workspace: z.string() };
  const wrap = (fn: (args: Record<string, unknown>) => Promise<unknown>) => async (args: Record<string, unknown>) => { try { return result(await fn({ ...args, client_key: _config.principal })); } catch (error) { if (error instanceof FleetError) return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ code: error.code, retryable: error.retryable }) }] }; return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ code: "INTERNAL", retryable: false }) }] }; } };
  server.registerTool("fleet_register_external", { inputSchema: { ...common, client_key: z.string(), display_name: z.string() } }, wrap((a) => gateway.register(String(a.workspace), String(a.client_key), String(a.display_name))));
  server.registerTool("fleet_agents", { inputSchema: common }, wrap((a) => gateway.agents(String(a.workspace))));
  server.registerTool("fleet_send", { inputSchema: { ...common, client_key: z.string(), recipient_id: z.string(), text: z.string(), idempotency_key: z.string(), correlation_id: z.string().optional() } }, wrap((a) => gateway.send(String(a.workspace), String(a.client_key), String(a.recipient_id), String(a.text), String(a.idempotency_key), a.correlation_id ? String(a.correlation_id) : undefined)));
  server.registerTool("fleet_inbox", { inputSchema: { ...common, client_key: z.string() } }, wrap((a) => gateway.inbox(String(a.workspace), String(a.client_key))));
  server.registerTool("fleet_ack", { inputSchema: { ...common, client_key: z.string(), message_ids: z.array(z.string()) } }, wrap((a) => gateway.ack(String(a.workspace), String(a.client_key), a.message_ids as string[])));
  server.registerTool("fleet_status", { inputSchema: { ...common, client_key: z.string() } }, wrap((a) => gateway.status(String(a.workspace), String(a.client_key))));
  server.registerTool("fleet_unregister_external", { inputSchema: { ...common, client_key: z.string(), agent_id: z.string() } }, wrap(async (a) => { await gateway.unregister(String(a.workspace), String(a.client_key), String(a.agent_id)); return { ok: true }; }));
  return server;
}
export async function startHttp(config: FleetConfig, gateway: FleetGateway): Promise<HttpServer> {
  const server = createServer(async (req, res) => {
    if (req.url === "/healthz") { res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}'); return; }
    if (req.url === "/readyz") { res.writeHead(200, { "content-type": "application/json" }).end('{"ready":true}'); return; }
    if (req.url !== config.mcpPath) { res.writeHead(404).end(); return; }
    if (req.headers.authorization !== `Bearer ${config.bearerToken}`) { res.writeHead(401, { "www-authenticate": "Bearer" }).end(); return; }
    let body = ""; let bodyBytes = 0; req.on("data", (chunk: Buffer) => { bodyBytes += chunk.length; if (bodyBytes > 1024 * 1024) { req.destroy(); return; } body += chunk.toString(); }); req.on("end", async () => { try { const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }); const mcp = createMcpServer(config, gateway); await mcp.connect(transport); await transport.handleRequest(req, res, JSON.parse(body)); } catch { if (!res.headersSent) res.writeHead(500).end(); } });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(config.listenPort, config.listenHost, () => resolve()); });
  return server;
}
