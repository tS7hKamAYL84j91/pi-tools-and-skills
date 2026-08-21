import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgentsCommand } from "../../extensions/pi-panopticon/ui/agents-command.js";
import { registerExternalAgentCommands } from "../../extensions/pi-panopticon/ui/external-agent-command.js";
import { registerAgentListModeControls } from "../../extensions/pi-panopticon/ui/list-mode-command.js";
import { createAgentListModeStore } from "../../extensions/pi-panopticon/ui/list-mode.js";
import type { AgentOverlayDeps } from "../../extensions/pi-panopticon/ui/agent-overlay-types.js";
import { asExtensionApi, makeAgentRecord, makeMockExtensionApi, makeRegistry } from "./helpers.js";

const registrarMocks = vi.hoisted(() => ({
	list: vi.fn(),
	register: vi.fn(),
	unregister: vi.fn(),
}));

vi.mock("../../extensions/pi-panopticon/registry/external-registrar.js", () => ({
	listExternalAgents: registrarMocks.list,
	registerExternalAgent: registrarMocks.register,
	unregisterExternalAgent: registrarMocks.unregister,
}));

interface CommandDefinition {
	description?: string;
	handler: (args: string | undefined, ctx: ExtensionCommandContext) => Promise<void>;
}

interface HeadlessContext {
	ctx: ExtensionCommandContext;
	notify: ReturnType<typeof vi.fn>;
}

function makeHeadlessContext(): HeadlessContext {
	const notify = vi.fn();
	return {
		ctx: { cwd: "/workspace/project", ui: { notify } } as unknown as ExtensionCommandContext,
		notify,
	};
}

function makeCommands(): { api: ReturnType<typeof makeMockExtensionApi>; commands: Map<string, CommandDefinition> } {
	const api = makeMockExtensionApi();
	return { api, commands: api.registeredCommands as Map<string, CommandDefinition> };
}

function makeOverlayDeps() : AgentOverlayDeps {
	const self = makeAgentRecord({ id: "self", name: "pi-agent" });
	return {
		selfId: self.id,
		registry: makeRegistry(self, [self]),
		listMode: createAgentListModeStore(),
		sendAgentMessage: vi.fn(),
		stopAgent: vi.fn(),
	};
}

describe("panopticon UI slash commands", () => {
	beforeEach(() => vi.resetAllMocks());

	it("reports usage for missing external-agent arguments", async () => {
		const { api, commands } = makeCommands();
		registerExternalAgentCommands(asExtensionApi(api), makeRegistry(undefined));
		const { ctx, notify } = makeHeadlessContext();

		await commands.get("agent-external-register")?.handler("  ", ctx);
		await commands.get("agent-external-remove")?.handler(undefined, ctx);

		expect(notify).toHaveBeenNthCalledWith(1, "Usage: /agent-external-register <name>", "warning");
		expect(notify).toHaveBeenNthCalledWith(2, "Usage: /agent-external-remove <name>", "warning");
		expect(registrarMocks.register).not.toHaveBeenCalled();
	});

	it("handles registration errors and case-insensitive removal", async () => {
		const { api, commands } = makeCommands();
		const registry = makeRegistry(undefined);
		registerExternalAgentCommands(asExtensionApi(api), registry);
		const fixture = makeHeadlessContext();
		registrarMocks.register.mockRejectedValue(new Error("mailbox unavailable"));
		await commands.get("agent-external-register")?.handler("worker", fixture.ctx);
		expect(fixture.notify).toHaveBeenCalledWith("mailbox unavailable", "error");

		registrarMocks.list.mockResolvedValue([{ id: "worker-id", name: "Worker", kind: "external", mailboxPath: "/mailbox" }]);
		await commands.get("agent-external-remove")?.handler(" worker ", fixture.ctx);
		expect(registrarMocks.unregister).toHaveBeenCalledWith({ workspaceRoot: "/workspace/project" }, "worker-id");
	});

	it("lists empty and populated external-agent registries", async () => {
		const { api, commands } = makeCommands();
		registerExternalAgentCommands(asExtensionApi(api), makeRegistry(undefined));
		const fixture = makeHeadlessContext();
		registrarMocks.list.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "w", name: "worker", kind: "external", mailboxPath: "/mailbox" }]);
		await commands.get("agent-external-list")?.handler(undefined, fixture.ctx);
		await commands.get("agent-external-list")?.handler("", fixture.ctx);
		expect(fixture.notify).toHaveBeenCalledWith("No external agents registered", "info");
		expect(fixture.notify).toHaveBeenCalledWith(expect.stringContaining("worker: /mailbox"), "info");
	});

	it("validates and applies agent list modes from arguments", async () => {
		const { api, commands } = makeCommands();
		const deps = makeOverlayDeps();
		registerAgentListModeControls(asExtensionApi(api), deps.registry, deps.listMode);
		const fixture = makeHeadlessContext();
		await commands.get("agent-list-mode")?.handler("invalid", fixture.ctx);
		expect(fixture.notify).toHaveBeenCalledWith(expect.stringContaining("Invalid agent list mode"), "warning");
		await commands.get("agents-mode")?.handler(" roots ", fixture.ctx);
		expect(deps.listMode.get(deps.registry.getRecord())).toBe("roots");
		expect(commands.get("agent-list-mode")?.description).toContain("all|children|roots|scope");
	});

	it("returns a useful response when no agents are registered", async () => {
		const { api, commands } = makeCommands();
		const commandApi = { ...api, registerShortcut: vi.fn() } as unknown as ExtensionAPI;
		const self = makeAgentRecord({ id: "self" });
		const deps = makeOverlayDeps();
		deps.registry.getRecord = vi.fn(() => self);
		deps.registry.readAllPeers = vi.fn(() => []);
		registerAgentsCommand(commandApi, deps);
		const fixture = makeHeadlessContext();
		await commands.get("agents")?.handler(undefined, fixture.ctx);
		expect(fixture.notify).toHaveBeenCalledWith("No agents registered", "info");
	});
});
