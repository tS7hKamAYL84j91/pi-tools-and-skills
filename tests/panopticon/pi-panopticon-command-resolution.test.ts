/**
 * Exact slash-command regression coverage for related Panopticon commands.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { registerAgentsCommand } from "../../extensions/pi-panopticon/ui/agents-command.js";
import { createAgentListModeStore } from "../../extensions/pi-panopticon/ui/list-mode.js";
import { registerAgentListModeControls } from "../../extensions/pi-panopticon/ui/list-mode-command.js";
import type { AgentRecord, Registry } from "../../extensions/pi-panopticon/types.js";

interface CommandDefinition {
	description?: string;
	handler: (args: string | undefined, ctx: ExtensionCommandContext) => Promise<void>;
}

interface CapturedUi {
	notifications: string[];
	overlays: string[];
}

interface FakeTheme {
	fg: (name: string, text: string) => string;
	bold: (text: string) => string;
}

function record(id: string): AgentRecord {
	return {
		id,
		name: id,
		pid: 1234,
		cwd: "/tmp/project",
		model: "provider/model",
		startedAt: Date.now() - 1_000,
		heartbeat: Date.now(),
		status: "waiting",
		task: "Test command routing",
		pendingMessages: 0,
	};
}

function createRegistry(self: AgentRecord, peers: AgentRecord[]): Registry {
	return {
		selfId: self.id,
		getRecord: () => self,
		register: () => undefined,
		unregister: () => undefined,
		setStatus: () => undefined,
		updateModel: () => undefined,
		setTask: () => undefined,
		setName: () => undefined,
		updatePendingMessages: () => undefined,
		readAllPeers: () => peers,
		flush: () => undefined,
		isRootSession: () => true,
	};
}

function createCommandApi(commands: Map<string, CommandDefinition>): ExtensionAPI {
	return {
		registerCommand(name: string, definition: CommandDefinition): void {
			commands.set(name, definition);
		},
		registerShortcut: () => undefined,
	} as unknown as ExtensionAPI;
}

function createContext(ui: CapturedUi): ExtensionCommandContext {
	const theme: FakeTheme = {
		fg: (_name: string, text: string) => text,
		bold: (text: string) => text,
	};
	return {
		ui: {
			notify(message: string): void {
				ui.notifications.push(message);
			},
			custom<T>(factory: (tui: { requestRender: () => void }, theme: FakeTheme, keyboard: unknown, done: (value: T) => void) => { render: (width: number) => string[] }): Promise<T | null> {
				const component = factory({ requestRender: () => undefined }, theme, {}, () => undefined);
				ui.overlays.push(component.render(80).join("\n"));
				return Promise.resolve(null);
			},
		},
	} as unknown as ExtensionCommandContext;
}

async function executeSlashCommand(
	input: string,
	commands: Map<string, CommandDefinition>,
	ctx: ExtensionCommandContext,
): Promise<boolean> {
	if (!input.startsWith("/")) {
		return false;
	}
	const spaceIndex = input.indexOf(" ");
	const commandName = spaceIndex === -1 ? input.slice(1) : input.slice(1, spaceIndex);
	const args = spaceIndex === -1 ? "" : input.slice(spaceIndex + 1);
	const command = commands.get(commandName);
	if (!command) {
		return false;
	}
	await command.handler(args, ctx);
	return true;
}

describe("pi-panopticon slash command resolution", () => {
	function setup(): { commands: Map<string, CommandDefinition>; ui: CapturedUi; ctx: ExtensionCommandContext } {
		const self = record("self");
		const commands = new Map<string, CommandDefinition>();
		const registry = createRegistry(self, [self, record("worker")]);
		const listMode = createAgentListModeStore();
		const api = createCommandApi(commands);
		registerAgentListModeControls(api, registry, listMode);
		registerAgentsCommand(api, {
			selfId: self.id,
			registry,
			listMode,
			sendAgentMessage: async () => ({ accepted: true }),
			stopAgent: async () => ({ accepted: true }),
		});
		const ui: CapturedUi = { notifications: [], overlays: [] };
		return { commands, ui, ctx: createContext(ui) };
	}

	it("resolves /agents exact-enter to the Agent Panopticon overlay", async () => {
		const { commands, ui, ctx } = setup();

		await expect(executeSlashCommand("/agents", commands, ctx)).resolves.toBe(true);

		expect(ui.notifications.join("\n")).toContain("self:idle");
		expect(ui.overlays).toHaveLength(1);
		expect(ui.overlays[0]).toContain("Agent Panopticon");
		expect(ui.overlays[0]).not.toContain("Agent List Mode");
	});

	it.each(["/agents-mode", "/agent-list-mode"])("resolves %s exact-enter to the list-mode chooser", async (input) => {
		const { commands, ui, ctx } = setup();

		await expect(executeSlashCommand(input, commands, ctx)).resolves.toBe(true);

		expect(ui.notifications).toHaveLength(0);
		expect(ui.overlays).toHaveLength(1);
		expect(ui.overlays[0]).toContain("Agent List Mode");
		expect(ui.overlays[0]).not.toContain("Agent Panopticon");
	});
});
