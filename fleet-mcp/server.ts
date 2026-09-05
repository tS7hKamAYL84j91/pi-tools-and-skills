import { timingSafeEqual, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod/v4";
import type { FleetConfig } from "./config.js";
import { FleetError, type FleetGateway } from "./gateway.js";

const MAX_HTTP_BODY_BYTES = 1024 * 1024;

function success(value: unknown) {
	const structuredContent = { result: value };
	return {
		content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
		structuredContent,
	};
}

function failure(error: unknown) {
	const requestId = randomUUID();
	const fleetError = error instanceof FleetError ? error : new FleetError("INTERNAL");
	return {
		isError: true,
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({ code: fleetError.code, retryable: fleetError.retryable, request_id: requestId }),
			},
		],
	};
}

async function invoke(operation: () => Promise<unknown>) {
	try {
		return success(await operation());
	} catch (error) {
		return failure(error);
	}
}

const workspace = z.string().min(1);

export function createMcpServer(_config: FleetConfig, gateway: FleetGateway): McpServer {
	const server = new McpServer({ name: "fleet-mcp", version: "1.1.0" });

	server.registerTool(
		"fleet_register_external",
		{
			description: "Register the authenticated fixed principal as a durable external fleet agent.",
			inputSchema: z.strictObject({ workspace, display_name: z.string().min(1).max(128) }),
			annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		(args) => invoke(() => gateway.register(args.workspace, args.display_name)),
	);
	server.registerTool(
		"fleet_agents",
		{
			description: "List external agents visible in the configured workspace.",
			inputSchema: z.strictObject({ workspace }),
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		(args) => invoke(() => gateway.agents(args.workspace)),
	);
	server.registerTool(
		"fleet_send",
		{
			description: "Durably publish a message from the authenticated fixed principal.",
			inputSchema: z.strictObject({
				workspace,
				recipient_id: z.string().min(1),
				text: z.string(),
				idempotency_key: z.string().min(1).max(256),
				correlation_id: z.string().optional(),
			}),
			annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		(args) =>
			invoke(() =>
				gateway.send(
					args.workspace,
					args.recipient_id,
					args.text,
					args.idempotency_key,
					args.correlation_id,
				),
			),
	);
	server.registerTool(
		"fleet_inbox",
		{
			description: "Read the authenticated principal's inbox without consuming messages.",
			inputSchema: z.strictObject({ workspace }),
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		(args) => invoke(() => gateway.inbox(args.workspace)),
	);
	server.registerTool(
		"fleet_ack",
		{
			description: "Durably acknowledge owned inbox messages; repeated acknowledgement succeeds.",
			inputSchema: z.strictObject({ workspace, message_ids: z.array(z.string()).max(_config.limits.maxAckIds) }),
			annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
		},
		(args) => invoke(() => gateway.ack(args.workspace, args.message_ids)),
	);
	server.registerTool(
		"fleet_status",
		{
			description: "Report bounded backend and inbox readiness for the authenticated principal.",
			inputSchema: z.strictObject({ workspace }),
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		(args) => invoke(() => gateway.status(args.workspace)),
	);
	server.registerTool(
		"fleet_unregister_external",
		{
			description: "Remove owned registration metadata while retaining mailbox history.",
			inputSchema: z.strictObject({ workspace, agent_id: z.string().min(1) }),
			annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
		},
		(args) => invoke(async () => {
			await gateway.unregister(args.workspace, args.agent_id);
			return { ok: true };
		}),
	);
	return server;
}

function authorized(request: IncomingMessage, expectedToken: string): boolean {
	const prefix = "Bearer ";
	const header = request.headers.authorization;
	if (!header?.startsWith(prefix)) return false;
	const supplied = Buffer.from(header.slice(prefix.length));
	const expected = Buffer.from(expectedToken);
	return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

class HttpRequestError extends Error {
	constructor(readonly status: number) {
		super(`HTTP ${status}`);
	}
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let bytes = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		bytes += buffer.length;
		if (bytes > MAX_HTTP_BODY_BYTES) throw new HttpRequestError(413);
		chunks.push(buffer);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new HttpRequestError(400);
	}
}

export async function startHttp(config: FleetConfig, gateway: FleetGateway): Promise<HttpServer> {
	if (!config.bearerToken) throw new Error("HTTP bearer token is not configured");
	const server = createServer(async (request, response) => {
		const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
		if (pathname === "/healthz") {
			response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
			return;
		}
		if (pathname === "/readyz") {
			const ready = await gateway.ready();
			response.writeHead(ready ? 200 : 503, { "content-type": "application/json" }).end(
				ready ? '{"ready":true}' : '{"ready":false}',
			);
			return;
		}
		if (pathname !== config.mcpPath) {
			response.writeHead(404).end();
			return;
		}
		if (!authorized(request, config.bearerToken ?? "")) {
			response.writeHead(401, { "www-authenticate": "Bearer" }).end();
			return;
		}
		if (request.method !== "POST") {
			response.writeHead(405, { allow: "POST" }).end();
			return;
		}
		let mcp: McpServer | undefined;
		try {
			const body = await readJsonBody(request);
			const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
			mcp = createMcpServer(config, gateway);
			await mcp.connect(transport);
			await transport.handleRequest(request, response, body);
		} catch (error) {
			if (!response.headersSent) response.writeHead(error instanceof HttpRequestError ? error.status : 500).end();
		} finally {
			await mcp?.close().catch(() => undefined);
		}
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(config.listenPort, config.listenHost, resolve);
	});
	return server;
}
