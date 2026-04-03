/**
 * Tests for pi-messaging.ts
 *
 * Injects mock MessageTransports for send and broadcast.
 * No real sockets, dirs, or transports touched.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from "vitest";

vi.mock("../lib/agent-registry.js", () => ({
	REGISTRY_DIR: "/fake/.pi/agents",
	readAllAgentRecords: vi.fn(),
	writeAgentRecord: vi.fn(),
}));

vi.mock("../lib/transports/maildir.js", () => ({
	createMaildirTransport: vi.fn(() => ({})),
}));

import * as registry from "../lib/agent-registry.js";
import { createMessagingExtension } from "../extensions/pi-messaging.js";
import type { MessageTransport, DeliveryResult, InboundMessage } from "../lib/message-transport.js";

const mockReadAll = registry.readAllAgentRecords as MockedFunction<typeof registry.readAllAgentRecords>;

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

// ── Mock transport ──────────────────────────────────────────────

function makeMockTransport(): MessageTransport & {
	send: MockedFunction<MessageTransport["send"]>;
	receive: MockedFunction<MessageTransport["receive"]>;
	ack: MockedFunction<MessageTransport["ack"]>;
	prune: MockedFunction<MessageTransport["prune"]>;
	init: MockedFunction<MessageTransport["init"]>;
	pendingCount: MockedFunction<MessageTransport["pendingCount"]>;
} {
	return {
		send: vi.fn(),
		receive: vi.fn().mockReturnValue([]),
		ack: vi.fn(),
		prune: vi.fn(),
		init: vi.fn(),
		pendingCount: vi.fn().mockReturnValue(0),
	};
}

// ── Fixtures ────────────────────────────────────────────────────

const SELF = { id: "self-id", name: "me", pid: process.pid, cwd: "/", model: "x", heartbeat: Date.now(), startedAt: Date.now(), status: "running" as const };
const PEER_A = { id: "peer-a", name: "alice", pid: 999, cwd: "/", model: "x", socket: "/tmp/a.sock", heartbeat: Date.now(), startedAt: Date.now(), status: "running" as const };
const PEER_B = { id: "peer-b", name: "bob", pid: 998, cwd: "/", model: "x", socket: "/tmp/b.sock", heartbeat: Date.now(), startedAt: Date.now(), status: "running" as const };
const PEER_C = { id: "peer-c", name: "charlie", pid: 997, cwd: "/", model: "x", heartbeat: Date.now(), startedAt: Date.now(), status: "running" as const };

const ACCEPTED: DeliveryResult = { accepted: true, immediate: false, reference: "ref-001" };
const FAILED: DeliveryResult = { accepted: false, immediate: false, error: "ENOSPC" };

// ── Setup ───────────────────────────────────────────────────────

let api: MockAPI;
let sendTransport: ReturnType<typeof makeMockTransport>;
let broadcastTransport: ReturnType<typeof makeMockTransport>;

beforeEach(() => {
	vi.resetAllMocks();
	mockReadAll.mockReturnValue([SELF, PEER_A, PEER_B, PEER_C]);

	sendTransport = makeMockTransport();
	sendTransport.send.mockResolvedValue(ACCEPTED);

	broadcastTransport = makeMockTransport();
	broadcastTransport.send.mockResolvedValue(ACCEPTED);

	api = makeMockAPI();
	createMessagingExtension({ send: sendTransport, broadcast: broadcastTransport })(
		api as unknown as Parameters<ReturnType<typeof createMessagingExtension>>[0],
	);
});

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

	it("does not register agent_send_durable", () => {
		expect(api.registeredTools.has("agent_send_durable")).toBe(false);
	});

	it("returns error when peer not found", async () => {
		const result = await executeTool("agent_send", { name: "nobody", message: "hi" });
		expect(getText(result)).toContain('No agent named "nobody"');
		expect(getText(result)).toContain("alice");
	});

	it("sends via the send transport", async () => {
		const result = await executeTool("agent_send", { name: "alice", message: "hello" });
		expect(sendTransport.send).toHaveBeenCalledWith(PEER_A, "me", "hello");
		expect(getText(result)).toContain("Sent to alice");
	});

	it("does not use the broadcast transport", async () => {
		await executeTool("agent_send", { name: "alice", message: "hello" });
		expect(broadcastTransport.send).not.toHaveBeenCalled();
	});

	it("returns failure when transport rejects", async () => {
		sendTransport.send.mockResolvedValue(FAILED);
		const result = await executeTool("agent_send", { name: "alice", message: "hello" });
		expect(getText(result)).toContain("Failed");
	});

	it("does not send to self", async () => {
		const result = await executeTool("agent_send", { name: "me", message: "echo" });
		expect(getText(result)).toContain("No agent named");
	});
});

// ── agent_broadcast ─────────────────────────────────────────────

describe("agent_broadcast", () => {
	it("registers the tool", () => {
		expect(api.registeredTools.has("agent_broadcast")).toBe(true);
	});

	it("reports no peers when registry is empty", async () => {
		mockReadAll.mockReturnValue([SELF]);
		const result = await executeTool("agent_broadcast", { message: "hi" });
		expect(getText(result)).toContain("No peer agents");
	});

	it("reports no matches when filter matches nobody", async () => {
		const result = await executeTool("agent_broadcast", { message: "hi", filter: "zzz" });
		expect(getText(result)).toContain("No agents matching");
	});

	it("sends to all peers via broadcast transport", async () => {
		const result = await executeTool("agent_broadcast", { message: "everyone" });
		expect(broadcastTransport.send).toHaveBeenCalledTimes(3);
		expect(getText(result)).toContain("✓ alice");
		expect(getText(result)).toContain("✓ bob");
		expect(getText(result)).toContain("✓ charlie");
	});

	it("does not use the send transport", async () => {
		await executeTool("agent_broadcast", { message: "everyone" });
		expect(sendTransport.send).not.toHaveBeenCalled();
	});

	it("applies name filter", async () => {
		await executeTool("agent_broadcast", { message: "hey", filter: "ali" });
		expect(broadcastTransport.send).toHaveBeenCalledTimes(1);
		expect(broadcastTransport.send.mock.calls[0]?.[0]).toEqual(PEER_A);
	});

	it("reports failures per peer", async () => {
		broadcastTransport.send.mockImplementation(async (peer) => {
			return peer.name === "charlie" ? FAILED : ACCEPTED;
		});
		const result = await executeTool("agent_broadcast", { message: "hi" });
		expect(getText(result)).toContain("✓ alice");
		expect(getText(result)).toContain("✗ charlie");
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
		const { promise, ui } = runSend("ghost hello");
		await promise;
		expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("No agent"), "warning");
	});

	it("sends via send transport", async () => {
		const { promise, ui } = runSend("alice hello from cmd");
		await promise;
		expect(sendTransport.send).toHaveBeenCalledWith(PEER_A, "me", "hello from cmd");
		expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("alice"), "info");
	});

	it("reports error on failure", async () => {
		sendTransport.send.mockResolvedValue(FAILED);
		const { promise, ui } = runSend("alice hello");
		await promise;
		expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Failed"), "error");
	});
});

// ── Self-record caching ─────────────────────────────────────────

describe("self-record caching", () => {
	it("caches self-record after session_start so subsequent sends skip the PID scan", async () => {
		// Fire session_start — populates cache via one PID scan
		for (const h of api.eventHandlers.get("session_start") ?? []) await h();
		const callsAfterStart = mockReadAll.mock.calls.length;

		// agent_send resolves the peer (1 readAllAgentRecords) but should NOT re-scan for self
		await executeTool("agent_send", { name: "alice", message: "hi" });
		expect(mockReadAll.mock.calls.length).toBe(callsAfterStart + 1);
	});

	it("warm cache: agent_send triggers exactly one readAllAgentRecords for peer resolution", async () => {
		// Warm the cache via session_start
		for (const h of api.eventHandlers.get("session_start") ?? []) await h();
		vi.clearAllMocks();
		mockReadAll.mockReturnValue([SELF, PEER_A, PEER_B, PEER_C]);

		await executeTool("agent_send", { name: "alice", message: "hi" });
		expect(mockReadAll).toHaveBeenCalledTimes(1);
	});

	it("retries PID scan when self not found at session_start", async () => {
		// Simulate: our record not yet registered when session_start fires
		mockReadAll.mockReturnValue([]);
		for (const h of api.eventHandlers.get("session_start") ?? []) await h();
		expect(sendTransport.init).not.toHaveBeenCalled();

		// Later our record appears — getSelfRecord() should re-scan and find it
		mockReadAll.mockReturnValue([SELF, PEER_A]);
		const result = await executeTool("agent_send", { name: "alice", message: "hello" });
		expect(getText(result)).toContain("Sent to alice");
	});
});

// ── Inbox draining ──────────────────────────────────────────────

describe("inbox draining", () => {
	it("inits and drains on session_start", async () => {
		const inbound: InboundMessage[] = [
			{ id: "001.json", from: "alice", text: "ping", ts: 1 },
		];
		sendTransport.receive.mockReturnValue(inbound);

		for (const h of api.eventHandlers.get("session_start") ?? []) await h();

		expect(sendTransport.init).toHaveBeenCalledWith(SELF.id);
		expect(api.sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining("ping"),
			expect.anything(),
		);
		expect(sendTransport.ack).toHaveBeenCalledWith(SELF.id, "001.json");
		expect(sendTransport.prune).toHaveBeenCalled();
	});

	it("drains on agent_end", async () => {
		sendTransport.receive.mockReturnValue([
			{ id: "002.json", from: "bob", text: "pong", ts: 2 },
		]);
		for (const h of api.eventHandlers.get("agent_end") ?? []) await h();
		expect(api.sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining("pong"),
			expect.anything(),
		);
	});

	it("does nothing when no self record", async () => {
		mockReadAll.mockReturnValue([]);
		for (const h of api.eventHandlers.get("session_start") ?? []) await h();
		expect(sendTransport.init).not.toHaveBeenCalled();
	});
});
