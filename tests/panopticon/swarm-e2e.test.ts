import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { RuntimeControlPlane } from "../../lib/runtime-control-plane.js";
import { ok } from "../../lib/tool-result.js";
import { TeamStateManager } from "../../extensions/pi-teams/state.js";
import { registerSwarmCommand } from "../../extensions/pi-teams/swarm/swarm-commands.js";

interface RegisteredCommand {
	name: string;
	handler: (raw: string | undefined, ctx: { cwd: string; ui: { notify(message: string, level: "info" | "warning"): void } }) => Promise<void>;
}

describe("swarm command compatibility", () => {
	it("keeps dry-run-first UX and executes through the Teams facade", async () => {
		let command: RegisteredCommand | undefined;
		const run = vi.fn(async () => ok("root response", { team: "hierarchical-swarm-default", runId: "run-test-1" }) as unknown as import("../../extensions/pi-teams/team-run-completion.js").TeamRunToolResult);
		registerSwarmCommand({ registerCommand(name: string, value: Omit<RegisteredCommand, "name">) { command = { name, ...value }; } } as unknown as ExtensionAPI, {
			stateManager: new TeamStateManager(), runtime: new RuntimeControlPlane(), run, runAsync: vi.fn(),
		});
		if (!command) throw new Error("swarm command was not registered");
		const notify = vi.fn();
		const ctx = { cwd: process.cwd(), ui: { notify } };

		await command.handler("inspect API --profile fast", ctx);
		expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("Swarm dry run; no workers spawned."), "info");
		expect(run).not.toHaveBeenCalled();

		await command.handler("inspect API --profile fast --execute", ctx);
		expect(run).toHaveBeenCalledWith({ id: "hierarchical-swarm-default", prompt: "inspect API", profile: "fast" }, ctx);
	});
});
