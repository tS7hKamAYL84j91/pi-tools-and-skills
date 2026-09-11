/**
 * External agent registration commands.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	listExternalAgents,
	registerExternalAgent,
	unregisterExternalAgent,
} from "../registry/external-registrar.js";
import type { Registry } from "../types.js";
import { externalPeerConfig as configFromCwd } from "../registry/external-peer-source.js";

type ExternalRuntimeConfig = ReturnType<typeof configFromCwd>;

type CommandContext = Parameters<NonNullable<Parameters<ExtensionAPI["registerCommand"]>[1]>["handler"]>[1];

async function refreshExternalPeers(registry: Registry, config: ExternalRuntimeConfig): Promise<void> {
	registry.setExternalPeers(await listExternalAgents(config));
}

async function handleExternalAgentRegister(name: string | undefined, ctx: CommandContext, registry: Registry): Promise<void> {
	if (!name) {
		ctx.ui.notify("Usage: /agent-external-register \u003cname\u003e", "warning");
		return;
	}
	try {
		const config = configFromCwd(ctx.cwd);
		const record = await registerExternalAgent(config, { name }, registry.readAllPeers());
		await refreshExternalPeers(registry, config);
		ctx.ui.notify(
			`Registered external agent "${record.name}" at ${record.mailboxPath}`,
			"info",
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(message, "error");
	}
}

async function handleExternalAgentList(ctx: CommandContext, registry: Registry): Promise<void> {
	const config = configFromCwd(ctx.cwd);
	const agents = await listExternalAgents(config);
	registry.setExternalPeers(agents);
	if (agents.length === 0) {
		ctx.ui.notify("No external agents registered", "info");
		return;
	}
	const lines = agents.map((record) => `  ${record.name}: ${record.mailboxPath}`);
	ctx.ui.notify(["External agents:", ...lines].join("\n"), "info");
}

async function handleExternalAgentRemove(name: string | undefined, ctx: CommandContext, registry: Registry): Promise<void> {
	if (!name) {
		ctx.ui.notify("Usage: /agent-external-remove \u003cname\u003e", "warning");
		return;
	}
	const agents = await listExternalAgents(configFromCwd(ctx.cwd));
	const match = agents.find((record) => record.name.toLowerCase() === name.toLowerCase());
	if (!match) {
		ctx.ui.notify(`No external agent named "${name}"`, "warning");
		return;
	}
	const config = configFromCwd(ctx.cwd);
	await unregisterExternalAgent(config, match.id);
	await refreshExternalPeers(registry, config);
	ctx.ui.notify(`Removed external agent "${match.name}"`, "info");
}

export async function dispatchExternalAgentCommand(
	rest: string,
	ctx: CommandContext,
	registry: Registry,
): Promise<void> {
	const trimmed = rest.trim();
	const first = trimmed.split(/\s+/)[0] ?? "";
	const target = trimmed.slice(first.length).trim() || undefined;
	switch (first) {
		case "list":
		case "":
			return handleExternalAgentList(ctx, registry);
		case "register":
			return handleExternalAgentRegister(target, ctx, registry);
		case "remove":
			return handleExternalAgentRemove(target, ctx, registry);
		default:
			ctx.ui.notify("Usage: /agents external [list|register <name>|remove <name>]", "warning");
	}
}

export function registerExternalAgentCommands(pi: ExtensionAPI, registry: Registry): void {
	pi.registerCommand("agent-external-register", {
		description: "Register an external (non-pi) agent mailbox (alias for /agents external register)",
		handler: async (args, ctx) => handleExternalAgentRegister(args?.trim(), ctx, registry),
	});

	pi.registerCommand("agent-external-list", {
		description: "List registered external agents (alias for /agents external list)",
		handler: async (_args, ctx) => handleExternalAgentList(ctx, registry),
	});

	pi.registerCommand("agent-external-remove", {
		description: "Remove an external agent registration (alias for /agents external remove)",
		handler: async (args, ctx) => handleExternalAgentRemove(args?.trim(), ctx, registry),
	});
}
