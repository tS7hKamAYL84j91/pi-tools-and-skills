/**
 * Characterisation tests for pi-messaging.ts
 *
 * These tests lock in the observable behaviour of the three send paths
 * (agent_send, agent_send_durable, agent_broadcast) and inbox draining
 * before any refactoring. They mock agent-registry and node:fs so no
 * real sockets or dirs are touched.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from "vitest";

// ── Mock agent-registry BEFORE importing pi-messaging ──────────
vi.mock("../extensions/agent-registry.js", () => ({
	REGISTRY_DIR: "/fake/.pi/agents",
	readAllAgentRecords: vi.fn(),
	socketSend: vi.fn(),
	ensureInbox: vi.fn(),
	inboxReadNew: vi.fn(),
	inboxAcknowledge: vi.fn(),
	inboxPruneCur: vi.fn(),
}));

// Mock node:fs so durableWrite doesn't touch the real filesystem
vi.mock("node:fs", () => ({
	existsSync: vi.fn(),
	mkdirSync: vi.fn(),
	renameSync: vi.fn(),
	writeFileSync: vi.fn(),
}));

vi.mock("node:crypto", () => ({
	randomUUID: vi.fn(() => "test-uuid-1234"),
}));

import * as registry from "../extensions/agent-registry.js";
import * as nodefs from "node:fs";
import initMessaging from "../extensions/pi-messaging.js";

// ── Typed mocks ─────────────────────────────────────────────────

const mockReadAll = registry.readAllAgentRecords as MockedFunction<typeof registry.readAllAgentRecords>;
const mockSocketSend = registry.socketSend as MockedFunction<typeof registry.socketSend>;
const mockEnsureInbox = registry.ensureInbox as MockedFunction<typeof registry.ensureInbox>;
const mockInboxReadNew = registry.inboxReadNew as MockedFunction<typeof registry.inboxReadNew>;
const mockInboxAck = registry.inboxAcknowledge as MockedFunction<typeof registry.inboxAcknowledge>;
const mockInboxPrune = registry.inboxPruneCur as MockedFunction<typeof registry.inboxPruneCur>;
const mockExistsSync = nodefs.existsSync as MockedFunction<typeof nodefs.existsSync>;
const mockWriteFileSync = nodefs.writeFileSync as MockedFunction<typeof nodefs.writeFileSync>;
const mockRenameSync = nodefs.renameSync as MockedFunction<typeof nodefs.renameSync>;

// ── Minimal ExtensionAPI mock ───────────────────────────────────

type ToolExecute = (toolCallId: string, params: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
type CommandHandler = (args: string | undefined, ctx: { ui: { notify: (msg: string, level: string) => void } }) => Promise<void>;

interface MockAPI {
	registeredTools: Map<string, { execute: ToolExecute }>;
	registeredCommands: Map<string, { handler: CommandHandler }>;
	eventHandlers: Map<string, (() => Promise<void>)[]>;
	sendUserMessage: MockedFunction<(msg: string, opts?: unknown) => void>;
	on: (event: string, handler: () => Promise<void>) => void;
	registerTool: (def: { name: string; execute: ToolExecute }) => void;
	registerCommand: (name: string, def: { handler: CommandHandler }) => void;
}

function makeMockAPI(): MockAPI {
	const api: MockAPI = {
		registeredTools: new Map(),
		registeredCommands: new Map(),
		eventHandlers: new Map(),
		sendUserMessage: vi.fn(),
		on(event, handler) {
			const list = api.eventHandlers.get(event) ?? [];
			list.push(handler);
			api.eventHandlers.set(event, list);
		},
		registerTool(def) { api.registeredTools.set(def.name, def); },
		registerCommand(name, def) { api.registeredCommands.set(name, def); },
	};
	return api;
}

// ── Fixtures ────────────────────────────────────────────────────

const SELF_RECORD = { id: "self-id", name: "me", pid: process.pid, cwd: "/", model: "x", heartbeat: Date.now(), startedAt: Date.now(), status: "running" as const };
const PEER_A = { id: "peer-a-id", name: "alice", pid: 999, cwd: "/", model: "x", socket: "/tmp/alice.sock", heartbeat: Date.now(), startedAt: Date.now(), status: "running" as const };
const PEER_B = { id: "peer-b-id", name: "bob", pid: 998, cwd: "/", model: "x", socket: "/tmp/bob.sock", heartbeat: Date.now(), startedAt: Date.now(), status: "running" as const };
const PEER_NO_SOCK = { id: "nosock-id", name: "charlie", pid: 997, cwd: "/", model: "x", heartbeat: Date.now(), startedAt: Date.now(), status: "running" as const };

// ── Setup ───────────────────────────────────────────────────────

let api: MockAPI;

beforeEach(() => {
	vi.resetAllMocks(); // resets implementations AND call counts

	// Default: self is in registry; durable write ops succeed
	mockReadAll.mockReturnValue([SELF_RECORD, PEER_A, PEER_B, PEER_NO_SOCK]);
	mockExistsSync.mockReturnValue(false);    // socket file absent by default
	mockSocketSend.mockResolvedValue({ ok: true });
	mockInboxReadNew.mockReturnValue([]);
	mockEnsureInbox.mockReturnValue("/fake/inbox");
	// writeFileSync / renameSync / mkdirSync: no-ops by default (vi.fn())

	api = makeMockAPI();
	initMessaging(api as unknown as Parameters<typeof initMessaging>[0]);
});

// ── Helpers ─────────────────────────────────────────────────────

function executeTool(name: string, params: Record<string, unknown>) {
	const tool = api.registeredTools.get(name);
	if (!tool) throw new Error(`Tool "${name}" not registered`);
	return tool.execute("call-id", params, new AbortController().signal);
}

function getText(result: unknown): string {
	return (result as { content: Array<{ text: string }> }).content[0]?.text ?? "";
}

// ── agent_send ──────────────────────────────────────────────────

describe("agent_send", () => {
	it("registers the tool", () => {
		expect(api.registeredTools.has("agent_send")).toBe(true);
	});

	it("returns error when peer not found", async () => {
		const result = await executeTool("agent_send", { name: "nobody", message: "hi" });
		expect(getText(result)).toContain('No agent named "nobody"');
		expect(getText(result)).toContain("alice");
	});

	it("delivers via socket when available and succeeds", async () => {
		mockExistsSync.mockReturnValue(true);  // socket file exists
		mockSocketSend.mockResolvedValue({ ok: true });

		const result = await executeTool("agent_send", { name: "alice", message: "hello" });
		const text = getText(result);

		expect(mockSocketSend).toHaveBeenCalledOnce();
		expect(text).toContain("alice");
		expect(text).toContain("hello");
		// No durable write attempted when socket succeeds
		expect(mockWriteFileSync).not.toHaveBeenCalled();
	});

	it("falls back to durable inbox when socket throws", async () => {
		mockExistsSync.mockReturnValue(true);
		mockSocketSend.mockRejectedValue(new Error("ECONNREFUSED"));

		const result = await executeTool("agent_send", { name: "alice", message: "hello" });
		const text = getText(result);

		expect(mockWriteFileSync).toHaveBeenCalled();
		expect(mockRenameSync).toHaveBeenCalled();
		expect(text).toContain("queued");
	});

	it("falls back to durable inbox when no socket path", async () => {
		mockExistsSync.mockReturnValue(false);

		const result = await executeTool("agent_send", { name: "alice", message: "hello" });
		const text = getText(result);

		expect(mockSocketSend).not.toHaveBeenCalled();
		expect(mockWriteFileSync).toHaveBeenCalled();
		expect(text).toContain("queued");
	});

	it("returns failure when socket down and inbox write fails", async () => {
		mockExistsSync.mockReturnValue(false);
		mockWriteFileSync.mockImplementation(() => { throw new Error("ENOSPC"); });

		const result = await executeTool("agent_send", { name: "alice", message: "hello" });
		expect(getText(result)).toContain("Failed");
	});

	it("does not send to self", async () => {
		const result = await executeTool("agent_send", { name: "me", message: "echo" });
		expect(getText(result)).toContain("No agent named");
	});
});

// ── agent_send_durable ──────────────────────────────────────────

describe("agent_send_durable", () => {
	it("registers the tool", () => {
		expect(api.registeredTools.has("agent_send_durable")).toBe(true);
	});

	it("returns error when peer not found", async () => {
		const result = await executeTool("agent_send_durable", { name: "ghost", message: "hi" });
		expect(getText(result)).toContain("No agent named");
	});

	it("returns error when durable write fails", async () => {
		mockWriteFileSync.mockImplementation(() => { throw new Error("disk full"); });

		const result = await executeTool("agent_send_durable", { name: "alice", message: "hi" });
		expect(getText(result)).toContain("Failed to write durable");
	});

	it("always writes to inbox first", async () => {
		const result = await executeTool("agent_send_durable", { name: "alice", message: "important" });

		expect(mockWriteFileSync).toHaveBeenCalled();
		expect(mockRenameSync).toHaveBeenCalled();
		expect(getText(result)).toContain("alice");
	});

	it("also delivers via socket when available (+ durable backup)", async () => {
		mockExistsSync.mockReturnValue(true);
		mockSocketSend.mockResolvedValue({ ok: true });

		const result = await executeTool("agent_send_durable", { name: "alice", message: "important" });
		const text = getText(result);

		expect(mockSocketSend).toHaveBeenCalledOnce();
		expect(text).toContain("socket");
	});

	it("reports inbox-only when socket unavailable", async () => {
		mockExistsSync.mockReturnValue(false);

		const result = await executeTool("agent_send_durable", { name: "alice", message: "important" });
		const text = getText(result);

		expect(mockSocketSend).not.toHaveBeenCalled();
		expect(text).toContain("inbox");
	});
});

// ── agent_broadcast ─────────────────────────────────────────────

describe("agent_broadcast", () => {
	it("registers the tool", () => {
		expect(api.registeredTools.has("agent_broadcast")).toBe(true);
	});

	it("reports no peers when registry is empty (excluding self)", async () => {
		mockReadAll.mockReturnValue([SELF_RECORD]);

		const result = await executeTool("agent_broadcast", { message: "hi" });
		expect(getText(result)).toContain("No peer agents");
	});

	it("reports no matches when filter matches nobody", async () => {
		const result = await executeTool("agent_broadcast", { message: "hi", filter: "zzznobody" });
		expect(getText(result)).toContain("No agents matching");
	});

	it("sends to all peers and summarises results", async () => {
		mockExistsSync.mockReturnValue(true);
		mockSocketSend.mockResolvedValue({ ok: true });

		const result = await executeTool("agent_broadcast", { message: "everyone" });
		const text = getText(result);

		// alice, bob have sockets; charlie has no socket
		expect(mockSocketSend).toHaveBeenCalledTimes(2);
		expect(text).toContain("✓ alice");
		expect(text).toContain("✓ bob");
		expect(text).toContain("✗ charlie");
	});

	it("applies name filter", async () => {
		mockExistsSync.mockReturnValue(true);
		mockSocketSend.mockResolvedValue({ ok: true });

		await executeTool("agent_broadcast", { message: "hey", filter: "ali" });
		expect(mockSocketSend).toHaveBeenCalledTimes(1);
		const call = mockSocketSend.mock.calls[0];
		expect(call?.[0]).toBe("/tmp/alice.sock");
	});
});

// ── /send command ───────────────────────────────────────────────

describe("/send command", () => {
	it("registers the command", () => {
		expect(api.registeredCommands.has("send")).toBe(true);
	});

	function runSend(args: string | undefined) {
		const cmd = api.registeredCommands.get("send")!;
		const ui = { notify: vi.fn() };
		return { promise: cmd.handler(args, { ui }), ui };
	}

	it("warns on bad args", async () => {
		const { promise, ui } = runSend("justoneword");
		await promise;
		expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Usage"), "warning");
	});

	it("warns when peer not found", async () => {
		const { promise, ui } = runSend("ghost hello there");
		await promise;
		expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("No agent"), "warning");
	});

	it("sends durable + socket when socket available", async () => {
		mockExistsSync.mockReturnValue(true);
		mockSocketSend.mockResolvedValue({ ok: true });

		const { promise, ui } = runSend("alice hello from send command");
		await promise;

		expect(mockWriteFileSync).toHaveBeenCalled();
		expect(mockSocketSend).toHaveBeenCalledOnce();
		expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("socket"), "info");
	});

	it("reports queued when socket fails", async () => {
		mockExistsSync.mockReturnValue(false);

		const { promise, ui } = runSend("alice hello");
		await promise;

		expect(mockWriteFileSync).toHaveBeenCalled();
		expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("queued"), "info");
	});
});

// ── Inbox draining ──────────────────────────────────────────────

describe("inbox draining", () => {
	it("drains on session_start: calls ensureInbox and delivers messages", async () => {
		mockInboxReadNew.mockReturnValue([
			{ filename: "001.json", message: { id: "1", from: "alice", text: "ping", ts: 1 } },
		]);

		const handlers = api.eventHandlers.get("session_start") ?? [];
		for (const h of handlers) await h();

		expect(mockEnsureInbox).toHaveBeenCalledWith(SELF_RECORD.id);
		expect(api.sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining("ping"),
			expect.anything(),
		);
		expect(mockInboxAck).toHaveBeenCalledWith(SELF_RECORD.id, "001.json");
		expect(mockInboxPrune).toHaveBeenCalled();
	});

	it("drains on agent_end", async () => {
		mockInboxReadNew.mockReturnValue([
			{ filename: "002.json", message: { id: "2", from: "bob", text: "pong", ts: 2 } },
		]);

		const handlers = api.eventHandlers.get("agent_end") ?? [];
		for (const h of handlers) await h();

		expect(api.sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining("pong"),
			expect.anything(),
		);
	});

	it("does nothing when no self record", async () => {
		mockReadAll.mockReturnValue([]);

		const handlers = api.eventHandlers.get("session_start") ?? [];
		for (const h of handlers) await h();

		expect(mockEnsureInbox).not.toHaveBeenCalled();
		expect(api.sendUserMessage).not.toHaveBeenCalled();
	});
});
