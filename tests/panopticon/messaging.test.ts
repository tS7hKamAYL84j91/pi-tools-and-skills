/**
 * Tests for Panopticon messaging capability module.
 *
 * Injects mock MessageTransports for send and broadcast.
 * No real dirs or transports touched.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from "vitest";

vi.mock("../../lib/agent-registry.js", () => ({
	REGISTRY_DIR: "/fake/.pi/agents",
	onAgentCleanup: vi.fn(() => vi.fn()),
}));

vi.mock("../../lib/transports/maildir.js", () => ({
	createMaildirTransport: vi.fn(() => ({})),
}));

vi.mock("../../lib/message-transport.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../lib/message-transport.js")>();
	const channels = new Map<string, unknown>();
	return {
		...actual,
		registerChannel: vi.fn((name: string, transport: unknown) => channels.set(name, transport)),
		getChannels: vi.fn(() => channels),
	};
});

import * as registry from "../../lib/agent-registry.js";
import { createMessaging } from "../../extensions/pi-panopticon/messaging/messaging.js";
import type { MessageTransport, DeliveryResult } from "../../lib/message-transport.js";
import type { AgentRecord } from "../../lib/agent-registry.js";
import { asExtensionApi, makeAgentRecord, makeMockContext, makeMockExtensionApi, makeRegistry, toolText, type MockExtensionApi } from "./helpers.js";

// ── Mock transport ──────────────────────────────────────────────

function makeMockTransport(): MessageTransport & {
	send: MockedFunction<MessageTransport["send"]>;
	receive: MockedFunction<MessageTransport["receive"]>;
	ack: MockedFunction<MessageTransport["ack"]>;
	prune: MockedFunction<MessageTransport["prune"]>;
	init: MockedFunction<MessageTransport["init"]>;
	pendingCount: MockedFunction<MessageTransport["pendingCount"]>;
	cleanup: MockedFunction<MessageTransport["cleanup"]>;
} {
	return {
		send: vi.fn(),
		receive: vi.fn().mockReturnValue([]),
		ack: vi.fn(),
		prune: vi.fn(),
		init: vi.fn(),
		pendingCount: vi.fn().mockReturnValue(0),
		cleanup: vi.fn(),
	};
}

// ── Fixtures ────────────────────────────────────────────────────

const SELF: AgentRecord = makeAgentRecord({ id: "self-id", name: "me", cwd: "/", model: "x" });
const PEER_A: AgentRecord = makeAgentRecord({ id: "peer-a", name: "alice", pid: 999, cwd: "/", model: "x" });
const PEER_B: AgentRecord = makeAgentRecord({ id: "peer-b", name: "bob", pid: 998, cwd: "/", model: "x" });
const PEER_C: AgentRecord = makeAgentRecord({ id: "peer-c", name: "charlie", pid: 997, cwd: "/", model: "x" });

const ACCEPTED: DeliveryResult = { accepted: true, immediate: false, reference: "ref-001" };
const FAILED: DeliveryResult = { accepted: false, immediate: false, error: "ENOSPC" };

// ── Setup ───────────────────────────────────────────────────────

let api: MockExtensionApi;
let sendTransport: ReturnType<typeof makeMockTransport>;
let broadcastTransport: ReturnType<typeof makeMockTransport>;
let mockRegistry: ReturnType<typeof makeRegistry>;
let messagingModule: ReturnType<ReturnType<typeof createMessaging>>;

beforeEach(async () => {
	vi.resetAllMocks();

	sendTransport = makeMockTransport();
	sendTransport.send.mockResolvedValue(ACCEPTED);

	broadcastTransport = makeMockTransport();
	broadcastTransport.send.mockResolvedValue(ACCEPTED);

	api = makeMockExtensionApi();
	mockRegistry = makeRegistry(SELF, [SELF, PEER_A, PEER_B, PEER_C]);

	// Register the send transport as the "agent" channel so message_read can find it
	const { getChannels } = await import("../../lib/message-transport.js");
	const channels = (getChannels as MockedFunction<typeof getChannels>)();
	(channels as Map<string, unknown>).clear();
	(channels as Map<string, unknown>).set("agent", sendTransport);

	messagingModule = createMessaging({ send: sendTransport, broadcast: broadcastTransport })(
		asExtensionApi(api),
		mockRegistry,
	);
});

function executeTool(name: string, params: Record<string, unknown>) {
	const tool = api.registeredTools.get(name);
	if (!tool) throw new Error(`Tool "${name}" not registered`);
	return tool.execute("call-id", params, new AbortController().signal);
}

// ── agent_send ──────────────────────────────────────────────────

describe("agent_send", () => {
	it("does not register agent_send_durable", () => {
		expect(api.registeredTools.has("agent_send_durable")).toBe(false);
	});

	it("returns error when peer not found", async () => {
		const result = await executeTool("agent_send", { name: "nobody", message: "hi" });
		expect(toolText(result)).toContain('No agent named "nobody"');
		expect(toolText(result)).toContain("alice");
	});

	it("sends via the send transport", async () => {
		const result = await executeTool("agent_send", { name: "alice", message: "hello" });
		expect(sendTransport.send).toHaveBeenCalledWith(PEER_A, "me", "hello");
		expect(toolText(result)).toContain("Sent to alice");
	});

	it("does not use the broadcast transport", async () => {
		await executeTool("agent_send", { name: "alice", message: "hello" });
		expect(broadcastTransport.send).not.toHaveBeenCalled();
	});

	it("returns failure when transport rejects", async () => {
		sendTransport.send.mockResolvedValue(FAILED);
		const result = await executeTool("agent_send", { name: "alice", message: "hello" });
		expect(toolText(result)).toContain("Failed");
	});

	it("does not send to self", async () => {
		const result = await executeTool("agent_send", { name: "me", message: "echo" });
		expect(toolText(result)).toContain("No agent named");
	});
});

// ── agent_broadcast ─────────────────────────────────────────────

describe("agent_broadcast", () => {
	it("reports no peers when registry is empty", async () => {
		(mockRegistry.readAllPeers as MockedFunction<typeof mockRegistry.readAllPeers>).mockReturnValue([SELF]);
		const result = await executeTool("agent_broadcast", { message: "hi" });
		expect(toolText(result)).toContain("No peer agents");
	});

	it("reports no matches when filter matches nobody", async () => {
		const result = await executeTool("agent_broadcast", { message: "hi", filter: "zzz" });
		expect(toolText(result)).toContain("No agents matching");
	});

	it("sends to all peers via broadcast transport", async () => {
		const result = await executeTool("agent_broadcast", { message: "everyone" });
		expect(broadcastTransport.send).toHaveBeenCalledTimes(3);
		expect(toolText(result)).toContain("✓ alice");
		expect(toolText(result)).toContain("✓ bob");
		expect(toolText(result)).toContain("✓ charlie");
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
		expect(toolText(result)).toContain("✓ alice");
		expect(toolText(result)).toContain("✗ charlie");
	});
});

// ── /send command ───────────────────────────────────────────────

describe("/send command", () => {
	function runSend(args: string | undefined) {
		const cmd = api.registeredCommands.get("send");
		if (!cmd) {
			throw new Error("send command was not registered");
		}
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

describe("registry integration", () => {
	it("uses registry.getRecord() for self instead of PID scan", async () => {
		// agent_send uses registry.readAllPeers() for peer resolution
		await executeTool("agent_send", { name: "alice", message: "hi" });
		expect(mockRegistry.readAllPeers).toHaveBeenCalled();
		expect(mockRegistry.getRecord).toHaveBeenCalled();
	});

	it("agent_send resolves peers from registry", async () => {
		const result = await executeTool("agent_send", { name: "alice", message: "hello" });
		expect(toolText(result)).toContain("Sent to alice");
	});
});

// ── Cleanup hook ──────────────────────────────────────────────

describe("cleanup hook", () => {
	it("registers a cleanup hook on init that delegates to transport.cleanup", () => {
		const mockOnCleanup = registry.onAgentCleanup as MockedFunction<typeof registry.onAgentCleanup>;
		messagingModule.init(makeMockContext() as never);

		// onAgentCleanup should have been called with a function
		expect(mockOnCleanup).toHaveBeenCalledTimes(1);
		const hook = mockOnCleanup.mock.calls[0]?.[0];
		expect(typeof hook).toBe("function");

		// Invoking the hook should delegate to transport.cleanup
		hook?.("dead-agent-id");
		expect(sendTransport.cleanup).toHaveBeenCalledWith("dead-agent-id");
	});
});

// ── Inbox draining ──────────────────────────────────────────────

describe("inbox draining", () => {
	it("inits transport and pokes on init() when messages pending", () => {
		sendTransport.pendingCount.mockReturnValue(1);
		messagingModule.init(makeMockContext() as never);

		expect(sendTransport.init).toHaveBeenCalledWith(SELF.id);
		// Should poke immediately (not dump bodies) since there are pending messages
		expect(api.sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining("new message"),
			expect.anything(),
		);
	});

	it("message_read drains channel and returns wrapped content", async () => {
		sendTransport.receive.mockReturnValue([
			{ id: "002.json", from: "bob", text: "pong", ts: 2 },
		]);
		const result = await executeTool("message_read", {});
		expect(toolText(result)).toContain("pong");
		expect(toolText(result)).toContain("<external-messages>");
		expect(sendTransport.ack).toHaveBeenCalledWith(SELF.id, "002.json");
		expect(sendTransport.prune).toHaveBeenCalled();
	});

	it("message_read includes attachment metadata", async () => {
		sendTransport.receive.mockReturnValue([
			{
				id: "004.json",
				from: "matrix:jim",
				text: "see attached",
				ts: 4,
				attachments: [{
					kind: "image",
					filename: "photo.png",
					mimeType: "image/png",
					sizeBytes: 123,
					localPath: "/tmp/photo.png",
					mxcUrl: "mxc://matrix.org/photo",
					eventId: "$event/photo",
				}],
			},
		]);
		const result = await executeTool("message_read", {});
		const text = toolText(result);
		expect(text).toContain("attachment:image");
		expect(text).toContain("photo.png");
		expect(text).toContain("/tmp/photo.png");
		expect(text).toContain("mxc://matrix.org/photo");
	});

	it("drainAll dumps messages directly for shutdown", () => {
		sendTransport.receive.mockReturnValue([
			{ id: "003.json", from: "charlie", text: "bye", ts: 3 },
		]);
		messagingModule.drainAll();
		expect(api.sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining("bye"),
			expect.anything(),
		);
	});

	it("does nothing when no self record", () => {
		(mockRegistry.getRecord as MockedFunction<typeof mockRegistry.getRecord>).mockReturnValue(undefined);
		messagingModule.init(makeMockContext() as never);
		expect(sendTransport.init).not.toHaveBeenCalled();
	});
});
