#!/usr/bin/env node
import { startFleet } from "./app.js";
import { parseFleetConfig, type FleetConfig } from "./config.js";

function loadConfig(): FleetConfig | undefined {
	try {
		return parseFleetConfig(JSON.parse(process.env.FLEET_MCP_CONFIG ?? "{}"));
	} catch {
		process.stderr.write("Invalid fleet configuration\n");
		process.exitCode = 1;
		return undefined;
	}
}

async function main(): Promise<void> {
	const config = loadConfig();
	if (!config) return;
	const runtime = await startFleet(config);
	let closing = false;
	const close = async () => {
		if (closing) return;
		closing = true;
		try {
			await runtime.close();
		} catch {
			process.exitCode = 1;
		}
	};
	process.once("SIGTERM", close);
	process.once("SIGINT", close);
}

main().catch(() => {
	process.stderr.write("Fleet MCP startup failed\n");
	process.exitCode = 1;
});
