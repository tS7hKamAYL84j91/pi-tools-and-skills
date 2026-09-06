import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { TeamStateManager } from "../../extensions/pi-teams/state.js";
import { registerTeamCommands } from "../../extensions/pi-teams/team-commands.js";

interface CommandDefinition {
	description?: string;
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

function setup(): {
	command: CommandDefinition;
	stateManager: TeamStateManager;
	notify: ReturnType<typeof vi.fn>;
	ctx: ExtensionCommandContext;
} {
	const commands = new Map<string, CommandDefinition>();
	const api = {
		registerCommand: (name: string, definition: CommandDefinition) => commands.set(name, definition),
	} as unknown as ExtensionAPI;
	const stateManager = new TeamStateManager();
	registerTeamCommands(api, { stateManager });
	const command = commands.get("teams");
	if (!command) throw new Error("teams command missing");
	const notify = vi.fn();
	const ctx = { ui: { notify } } as unknown as ExtensionCommandContext;
	return { command, stateManager, notify, ctx };
}

describe("/teams status and stop", () => {
	it("reports the same live and terminal state used by stop", async () => {
		const { command, stateManager, notify, ctx } = setup();
		const id = stateManager.startRun({ teamId: "navigator", protocol: "consult", prompt: "x" });
		await command.handler(`status ${id}`, ctx);
		expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("pending"), "info");
		stateManager.recordRunCompleted(id, 1);
		await command.handler(`status ${id}`, ctx);
		expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("completed"), "info");
		await expect(command.handler(`stop ${id}`, ctx)).rejects.toThrow("No active team run");
	});

	it("stops an explicit run id and documents the command", async () => {
		const { command, stateManager, notify, ctx } = setup();
		const runId = stateManager.startRun({ teamId: "navigator", protocol: "consult", prompt: "x" });

		await command.handler(`stop ${runId}`, ctx);

		expect(stateManager.get(runId)?.status).toBe("stopping");
		expect(notify).toHaveBeenCalledWith(expect.stringContaining(runId), "info");
		expect(command.description).toContain("stop [runId]");
	});

	it("stops the newest active run when no id is supplied", async () => {
		const { command, stateManager, ctx } = setup();
		stateManager.startRun({ teamId: "first", protocol: "consult", prompt: "x" });
		stateManager.startRun({ teamId: "second", protocol: "consult", prompt: "x" });
		const newest = stateManager.newestActiveRun();
		if (!newest) throw new Error("active run missing");

		await command.handler("stop", ctx);

		expect(stateManager.get(newest.id)?.status).toBe("stopping");
	});
});
