import { describe, expect, it, vi, beforeEach } from "vitest";

import { setupUI } from "../extensions/pi-panopticon/ui.js";
import type { Registry } from "../extensions/pi-panopticon/types.js";

function makeRegistry(): Registry {
	return {
		selfId: "self-id",
		getRecord: vi.fn(() => ({ id: "self-id", name: "registry-name", pid: 1, cwd: "/tmp", model: "x", startedAt: 1, heartbeat: 1, status: "waiting" as const })),
		register: vi.fn(),
		unregister: vi.fn(),
		setStatus: vi.fn(),
		updateModel: vi.fn(),
		setTask: vi.fn(),
		setName: vi.fn(),
		updatePendingMessages: vi.fn(),
		readAllPeers: vi.fn(() => []),
		flush: vi.fn(),
	};
}

describe("alias tools", () => {
	let tools: Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>;
	let commands: Map<string, { handler: (...args: unknown[]) => Promise<unknown> }>;
	let sessionAlias: string | undefined;

	beforeEach(() => {
		tools = new Map();
		commands = new Map();
		sessionAlias = undefined;
		const pi = {
			registerTool: vi.fn((tool) => tools.set(tool.name, tool)),
			registerCommand: vi.fn((name, command) => commands.set(name, command)),
			registerShortcut: vi.fn(),
			setSessionName: vi.fn((name: string) => {
				sessionAlias = name;
			}),
			getSessionName: vi.fn(() => sessionAlias),
		};
		setupUI(pi as never, makeRegistry(), "self-id");
	});

	it("set_alias updates the session alias without touching registry identity", async () => {
		const tool = tools.get("set_alias");
		if (!tool) throw new Error("set_alias not registered");
		const result = await tool.execute("id", { name: "chief" });
		expect(sessionAlias).toBe("chief");
		expect((result as { isError?: boolean }).isError).toBeFalsy();
	});

	it("get_alias reports alias and registry name separately", async () => {
		sessionAlias = "chief";
		const tool = tools.get("get_alias");
		if (!tool) throw new Error("get_alias not registered");
		const result = await tool.execute("id", {});
		const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? "";
		expect(text).toContain("chief");
		expect(text).toContain("registry-name");
	});

	it("/alias command sets the session alias", async () => {
		const command = commands.get("alias");
		if (!command) throw new Error("alias command not registered");
		const ctx = { ui: { notify: vi.fn() } };
		await command.handler("chief", ctx);
		expect(sessionAlias).toBe("chief");
	});
});
