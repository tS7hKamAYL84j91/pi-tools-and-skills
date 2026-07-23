import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { vi, type MockedFunction } from "vitest";
import type { AgentRecord } from "../../lib/agent-registry.js";
import type { Registry } from "../../extensions/pi-panopticon/types.js";

export function makeAgentRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
	const now = Date.now();
	return {
		id: "12345-abc",
		name: "test-agent",
		pid: 12345,
		cwd: "/tmp/test",
		model: "anthropic/claude-sonnet-4-6",
		startedAt: now - 60_000,
		heartbeat: now - 5_000,
		status: "running",
		pendingMessages: 0,
		sessionFile: "/tmp/test-session.jsonl",
		...overrides,
	};
}

export function makeRegistry(self: AgentRecord | undefined, peers: AgentRecord[] = []): Registry {
	return {
		selfId: self?.id ?? "self-id",
		getRecord: vi.fn(() => self),
		register: vi.fn(),
		unregister: vi.fn(),
		setStatus: vi.fn(),
		updateModel: vi.fn(),
		setTask: vi.fn(),
		setName: vi.fn(),
		updatePendingMessages: vi.fn(),
		readAllPeers: vi.fn(() => peers),
		flush: vi.fn(),
		isRootSession: vi.fn(() => true),
	};
}

export type ToolExecute = (toolCallId: string, params: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
export type CommandHandler = (args: string | undefined, ctx: { ui: { notify: (msg: string, level: string) => void } }) => Promise<void>;

export interface MockExtensionApi {
	registeredTools: Map<string, { execute: ToolExecute; prepareArguments?: (args: unknown) => unknown }>;
	registeredCommands: Map<string, { handler: CommandHandler }>;
	eventHandlers: Map<string, (() => Promise<void>)[]>;
	sendUserMessage: MockedFunction<(msg: string, opts?: unknown) => void>;
	on: (event: string, handler: () => Promise<void>) => void;
	registerTool: (def: { name: string; execute?: ToolExecute; prepareArguments?: (args: unknown) => unknown }) => void;
	registerCommand: (name: string, def: { handler: CommandHandler }) => void;
}

export function makeMockExtensionApi(): MockExtensionApi {
	const api: MockExtensionApi = {
		registeredTools: new Map(),
		registeredCommands: new Map(),
		eventHandlers: new Map(),
		sendUserMessage: vi.fn(),
		on(event, handler) {
			const list = api.eventHandlers.get(event) ?? [];
			list.push(handler);
			api.eventHandlers.set(event, list);
		},
		registerTool(def) {
			api.registeredTools.set(def.name, {
				execute: def.execute ?? (async () => undefined),
				prepareArguments: def.prepareArguments,
			});
		},
		registerCommand(name, def) { api.registeredCommands.set(name, def); },
	};
	return api;
}

export function asExtensionApi(api: MockExtensionApi): ExtensionAPI {
	return api as unknown as ExtensionAPI;
}

export function makeMockContext() {
	return {
		isIdle: vi.fn(() => true),
		ui: { notify: vi.fn(), setStatus: vi.fn(), theme: makeTheme() },
		hasUI: true,
		cwd: "/tmp",
		sessionManager: { getSessionDir: () => "/tmp", getSessionFile: () => "/tmp/s.jsonl", getEntries: () => [] },
	};
}

function makeTheme() {
	return { fg: (_color: string, text: string) => text, bold: (text: string) => text };
}

export function toolText(result: unknown): string {
	return (result as { content: Array<{ text: string }> }).content[0]?.text ?? "";
}
