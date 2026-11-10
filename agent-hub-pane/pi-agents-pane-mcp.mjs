/** Opt-in, tab-capability MCP adapter. The running sidebar owns every operation. */
import { createHash, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, isAbsolute } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod/v4";

const configSchema = z.strictObject({
	port: z.number().int().min(1024).max(65535),
	bearerToken: z.string().regex(/^[a-f0-9]{64}$/),
	maxPanes: z.number().int().min(2).max(32),
});

export function readMcpConfig(path) {
	let fd;
	try {
		if (!isAbsolute(path)) throw new Error();
		for (let current = path; ; current = dirname(current)) {
			if (lstatSync(current).isSymbolicLink()) throw new Error();
			if (current === dirname(current)) break;
		}
		const parent = lstatSync(dirname(path));
		if (!parent.isDirectory() || (parent.mode & 0o777) !== 0o700 || parent.uid !== process.getuid()) throw new Error();
		fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid() || stat.size > 4096) throw new Error();
		const bytes = Buffer.alloc(4097);
		let length = 0;
		while (length < bytes.length) {
			const count = readSync(fd, bytes, length, bytes.length - length, null);
			if (!count) break;
			length += count;
		}
		if (length > 4096) throw new Error();
		return configSchema.parse(JSON.parse(bytes.subarray(0, length).toString("utf8")));
	} catch {
		throw new Error("MCP requires an owned 0600 config in an owned 0700 directory; check port, bearerToken, and maxPanes");
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

function result(value) {
	return {
		isError: ["refused", "uncertain"].includes(value.status),
		content: [{ type: "text", text: JSON.stringify(value) }],
		structuredContent: value,
	};
}
const refused = (reason) => result({ status: "refused", reason });

// Cache is shared across HTTP requests. IDs are never evicted/replayed in one
// owner instance; callers must first list agents to learn the current instance.
function createHubMcpServer(handlers, instance, requests) {
	const server = new McpServer({ name: "agent-hub-sidebar", version: "1.2.0" });
	const invoke = async (work) => {
		try { return result(await work()); }
		catch { return refused("Sidebar operation unavailable"); }
	};
	const mutation = async (action, args, signal) => {
		if (args.instance_id !== instance) return refused("Sidebar instance changed; list agents again, do not replay mutations");
		const signature = JSON.stringify([action, args]);
		const old = requests.get(args.request_id);
		if (old) return old.signature === signature ? old.pending : refused("Request ID already used for different input");
		if (requests.size >= 256) return refused("Sidebar request limit reached; operator review required");
		const pending = invoke(() => handlers[action](args, signal));
		requests.set(args.request_id, { signature, pending });
		return pending;
	};
	const request = {
		instance_id: z.string().uuid(),
		request_id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/),
	};
	const target = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
	server.registerTool("hub_list_agents", {
		description: "List verified agents in this sidebar's fixed tab. Returns instance_id for subsequent requests; never exposes session paths or credentials.",
		inputSchema: z.strictObject({}),
		annotations: { readOnlyHint: true, openWorldHint: false },
	}, (_args, extra) => invoke(async () => ({ ...await handlers.list(extra.signal), instance_id: instance })));
	server.registerTool("hub_create_agent", {
		description: "Autonomously create an independent interactive Pi using the sidebar's New operation and configured model. Reuse request_id only for identical retries within instance_id. Pane creation is not proof of agent registration; list again to observe it. Never retry an uncertain outcome with a new ID.",
		inputSchema: z.strictObject({ ...request, name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/).refine((s) => !s.includes("..")) }),
		annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
	}, (args, extra) => mutation("create", args, extra.signal));
	server.registerTool("hub_close_agent", {
		description: "Request a human-confirmed close in this sidebar. Selects the verified target and asks the human to press c then y. This tool never closes a pane autonomously or deletes session history.",
		inputSchema: z.strictObject({ ...request, agent_id: target }),
		annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
	}, (args, extra) => mutation("close", args, extra.signal));
	server.registerTool("hub_set_lead", {
		description: "Set this sidebar's local lead designation using its Lead operation. Does not change registry ownership, namespaces, permissions, or other sidebars.",
		inputSchema: z.strictObject({ ...request, agent_id: target }),
		annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
	}, (args, extra) => mutation("lead", args, extra.signal));
	return server;
}

export async function startHubMcp(config, handlers, instance) {
	config = configSchema.parse(config);
	const expected = createHash("sha256").update(config.bearerToken).digest();
	const requests = new Map();
	let active = 0;
	const server = createServer(async (request, response) => {
		// No browser origins, forwarded hosts, remote listeners, or ambient auth.
		if (request.headers.host !== `127.0.0.1:${config.port}` || request.headers.origin !== undefined) {
			response.writeHead(403).end(); return;
		}
		if (request.url !== "/mcp") { response.writeHead(404).end(); return; }
		const auth = request.headers.authorization;
		if (typeof auth !== "string" || auth.length !== 71 || !auth.startsWith("Bearer ") ||
			!timingSafeEqual(expected, createHash("sha256").update(auth.slice(7)).digest())) {
			response.writeHead(401, { "www-authenticate": "Bearer" }).end(); return;
		}
		if (request.method !== "POST") { response.writeHead(405, { allow: "POST" }).end(); return; }
		if (active >= 8) { response.writeHead(503).end(); return; }
		active++;
		let mcp;
		try {
			const chunks = [];
			let bytes = 0;
			for await (const chunk of request) {
				bytes += chunk.length;
				if (bytes > 16384) { response.writeHead(413).end(); return; }
				chunks.push(chunk);
			}
			let body;
			try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
			catch { response.writeHead(400).end(); return; }
			if (!body || Array.isArray(body) || typeof body !== "object") { response.writeHead(400).end(); return; }
			mcp = createHubMcpServer(handlers, instance, requests);
			const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
			await mcp.connect(transport);
			await transport.handleRequest(request, response, body);
		} catch {
			if (!response.headersSent) response.writeHead(500).end();
		} finally {
			active--;
			await mcp?.close().catch(() => undefined);
		}
	});
	server.requestTimeout = 10000;
	server.headersTimeout = 10000;
	server.setTimeout(30000, (socket) => socket.destroy());
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(config.port, "127.0.0.1", resolve);
	});
	return { close() { server.closeAllConnections(); server.close(); } };
}
