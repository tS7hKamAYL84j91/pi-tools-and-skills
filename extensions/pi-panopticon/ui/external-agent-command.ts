/**
 * External agent registration commands.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	listExternalAgents,
	registerExternalAgent,
	unregisterExternalAgent,
} from "../registry/external-registrar.js";

interface ExternalRuntimeConfig {
	workspaceRoot?: string;
}

function configFromCwd(cwd: string): ExternalRuntimeConfig {
	return { workspaceRoot: cwd };
}

export function registerExternalAgentCommands(pi: ExtensionAPI): void {
	pi.registerCommand("agent-external-register", {
		description: "Register an external (non-pi) agent mailbox",
		handler: async (args, ctx) => {
			const name = args?.trim();
			if (!name) {
				ctx.ui.notify("Usage: /agent-external-register \u003cname\u003e", "warning");
				return;
			}
			try {
				const record = await registerExternalAgent(configFromCwd(ctx.cwd), { name });
				ctx.ui.notify(
					`Registered external agent "${record.name}" at ${record.mailboxPath}`,
					"info",
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(message, "error");
			}
		},
	});

	pi.registerCommand("agent-external-list", {
		description: "List registered external agents",
		handler: async (_args, ctx) => {
			const agents = await listExternalAgents(configFromCwd(ctx.cwd));
			if (agents.length === 0) {
				ctx.ui.notify("No external agents registered", "info");
				return;
			}
			const lines = agents.map((record) => `  ${record.name}: ${record.mailboxPath}`);
			ctx.ui.notify(["External agents:", ...lines].join("\n"), "info");
		},
	});

	pi.registerCommand("agent-external-remove", {
		description: "Remove an external agent registration",
		handler: async (args, ctx) => {
			const name = args?.trim();
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
			await unregisterExternalAgent(configFromCwd(ctx.cwd), match.id);
			ctx.ui.notify(`Removed external agent "${match.name}"`, "info");
		},
	});
}
