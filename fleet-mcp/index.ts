#!/usr/bin/env node
import { parseFleetConfig } from "./config.js";
import type { FleetConfig } from "./config.js";
import { FleetGateway } from "./gateway.js";
import { createMcpServer, startHttp } from "./server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

let config: FleetConfig;
try {
  config = parseFleetConfig(JSON.parse(process.env.FLEET_MCP_CONFIG ?? "{}"));
} catch {
  process.stderr.write("Invalid fleet configuration\n");
  process.exit(1);
}
const gateway = new FleetGateway(config);
await gateway.init();
if (config.transport === "stdio" || config.transport === "both") {
  const server = createMcpServer(config, gateway);
  await server.connect(new StdioServerTransport());
}
if (config.transport === "http" || config.transport === "both") await startHttp(config, gateway);
process.once("SIGTERM", () => process.exit(0));
