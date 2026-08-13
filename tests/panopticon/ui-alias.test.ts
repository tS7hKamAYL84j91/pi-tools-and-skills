import { describe, expect, it, vi, beforeEach } from "vitest";

import { createAgentListModeStore } from "../../extensions/pi-panopticon/ui/list-mode.js";
import { setupUI } from "../../extensions/pi-panopticon/ui/ui.js";
import type { Registry } from "../../extensions/pi-panopticon/types.js";

function makeRegistry(): Registry {
	return {
		selfId: "self-id",
		getRecord: vi.fn(() => ({
			id: "self-id",
			name: "registry-name",
			spawn_name: "spawned-name",
			name_source: "spawn" as const,
			pid: 1,
			cwd: "/tmp",
			model: "x",
			startedAt: 1,
			heartbeat: 1,
			status: "waiting" as const,
		})),
		register: vi.fn(),
		unregister: vi.fn(),
		setStatus: vi.fn(),
		updateModel: vi.fn(),
		setTask: vi.fn(),
		setName: vi.fn(),
		updatePendingMessages: vi.fn(),
		setExternalPeers: vi.fn(),
		readAllPeers: vi.fn(() => []),
		flush: vi.fn(),
		isRootSession: vi.fn(() => true),
	};
}

describe("name tools", () => {
	let tools: Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>;
	let commands: Map<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
	let sessionName: string | undefined;
	let registry: Registry;

	beforeEach(() => {
		tools = new Map();
		commands = new Map();
		sessionName = undefined;
		registry = makeRegistry();
		const pi = {
			registerTool: vi.fn((tool) => tools.set(tool.name, tool)),
			registerCommand: vi.fn((name, command) => commands.set(name, command)),
			registerShortcut: vi.fn(),
			setSessionName: vi.fn((name: string) => {
				sessionName = name;
			}),
			getSessionName: vi.fn(() => sessionName),
		};
		setupUI(pi as never, {
			selfId: "self-id",
			registry,
			listMode: createAgentListModeStore(),
			sendAgentMessage: async () => ({ accepted: true }),
			stopAgent: async () => ({ accepted: true }),
		});
	});

	it("set_name updates session name and registry name", async () => {
		const tool = tools.get("set_name");
		if (!tool) throw new Error("set_name not registered");
		const result = await tool.execute("id", { name: "chief" });
		expect(sessionName).toBe("chief");
		expect(registry.setName).toHaveBeenCalledWith("chief", "programmatic");
		expect((result as { isError?: boolean }).isError).toBeFalsy();
	});

	it("does not register deprecated alias tool wrappers", () => {
		expect(tools.has("set_alias")).toBe(false);
		expect(tools.has("get_alias")).toBe(false);
	});

	it("get_name reports current session, registry, and spawn names", async () => {
		sessionName = "chief";
		const tool = tools.get("get_name");
		if (!tool) throw new Error("get_name not registered");
		const result = await tool.execute("id", {});
		const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? "";
		expect(text).toContain("chief");
		expect(text).toContain("registry-name");
		expect(text).toContain("spawned-name");
	});

	it("does not register the removed /alias command", () => {
		expect(commands.has("alias")).toBe(false);
	});
});
