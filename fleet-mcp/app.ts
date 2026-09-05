import type { Server as HttpServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FleetConfig } from "./config.js";
import { FleetGateway } from "./gateway.js";
import { createMcpServer, startHttp } from "./server.js";

interface FleetRuntime {
	gateway: FleetGateway;
	close(): Promise<void>;
}

function closeHttp(server: HttpServer): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

/** Start the selected transports and return an explicit graceful-shutdown boundary. */
export async function startFleet(config: FleetConfig): Promise<FleetRuntime> {
	const gateway = new FleetGateway(config);
	await gateway.init();
	const mcpServers: McpServer[] = [];
	let httpServer: HttpServer | undefined;

	if (config.transport === "stdio" || config.transport === "both") {
		const server = createMcpServer(config, gateway);
		await server.connect(new StdioServerTransport());
		mcpServers.push(server);
	}
	if (config.transport === "http" || config.transport === "both") {
		httpServer = await startHttp(config, gateway);
	}

	return {
		gateway,
		async close() {
			if (httpServer) await closeHttp(httpServer);
			await Promise.all(mcpServers.map((server) => server.close()));
		},
	};
}
