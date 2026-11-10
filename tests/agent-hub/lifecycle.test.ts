/**
 * Integration tests for extensions/pi-agent-hub/index.ts lifecycle wiring.
 *
 * Verifies that the orchestrator calls modules in the correct order
 * during session_start, agent events, and session_shutdown.
 */

import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BEFORE_AGENT_CHANNEL_SHUTDOWN, type AgentChannelShutdown } from "../../lib/agent-shutdown.js";

// ── Mock all modules before import ──────────────────────────────

const mockRegister = vi.fn();
const mockUnregister = vi.fn();
const mockSetStatus = vi.fn();
const mockUpdateModel = vi.fn();
const mockSetTask = vi.fn();
const mockGetRecord = vi.fn((): { task: string | undefined; sessionFile: string } => ({ task: undefined, sessionFile: "/tmp/s.jsonl" }));
const mockFlush = vi.fn();
const mockReadAllPeers = vi.fn(() => []);
const mockSetExternalPeers = vi.fn();

vi.mock("../../extensions/pi-agent-hub/registry/registry.js", () => {
	return {
		default: class MockRegistry {
			selfId = "test-id";
			register = mockRegister;
			unregister = mockUnregister;
			setStatus = mockSetStatus;
			updateModel = mockUpdateModel;
			setTask = mockSetTask;
			getRecord = mockGetRecord;
			flush = mockFlush;
			setExternalPeers = mockSetExternalPeers;
			readAllPeers = mockReadAllPeers;
		},
	};
});

const mockMessagingInit = vi.fn();
const mockPokePending = vi.fn();
const mockDrainAll = vi.fn();
const mockMessagingDispose = vi.fn();

vi.mock("../../extensions/pi-agent-hub/messaging/messaging.js", () => ({
	createMessaging: vi.fn(() => vi.fn(() => ({ init: mockMessagingInit, pokePending: mockPokePending, drainAll: mockDrainAll, dispose: mockMessagingDispose }))),
}));

const externalRegistrarMocks = vi.hoisted(() => ({
	load: vi.fn(async () => [{ id: "ext-1", kind: "external" }]),
}));
vi.mock("../../extensions/pi-agent-hub/registry/external-registrar.js", () => ({
	loadExternalAgents: externalRegistrarMocks.load,
}));

vi.mock("../../lib/transports/maildir.js", () => ({
	getMaildirTransport: vi.fn(() => ({})),
}));

const channelMocks = vi.hoisted(() => ({
	unregisterChannel: vi.fn(),
}));

vi.mock("../../lib/message-transport.js", () => ({
	registerChannel: vi.fn(),
	unregisterChannel: channelMocks.unregisterChannel,
}));

vi.mock("../../extensions/pi-agent-hub/registry/peek.js", () => ({
	setupPeek: vi.fn(),
}));

const mockReconcilerStart = vi.fn();
const mockReconcilerStop = vi.fn();
const mockReconcilerOnAgentEnd = vi.fn();

vi.mock("../../extensions/pi-agent-hub/registry/reconciler.js", () => ({
	setupReconciler: vi.fn(() => ({ start: mockReconcilerStart, stop: mockReconcilerStop, onAgentEnd: mockReconcilerOnAgentEnd, handleInboundMessage: vi.fn() })),
}));

const mockUIStart = vi.fn();
const mockUIStop = vi.fn();

vi.mock("../../extensions/pi-agent-hub/ui/ui.js", () => ({
	setupUI: vi.fn(() => ({ start: mockUIStart, stop: mockUIStop, refresh: vi.fn() })),
}));

const mockShutdownAll = vi.fn(async () => {});
vi.mock("../../extensions/pi-subagents/spawner/spawner.js", () => ({
	setupSpawner: vi.fn(() => ({ shutdownAll: mockShutdownAll, onMissingDone: vi.fn() })),
}));

import piAgents from "../../extensions/pi-agent-hub/index.js";
import subagents from "../../extensions/pi-subagents/index.js";

// ── Mock ExtensionAPI ───────────────────────────────────────────

type Handler = (...args: unknown[]) => Promise<unknown>;

function makeMockPI() {
	const handlers = new Map<string, Handler[]>();
	return {
		handlers,
		events: createEventBus(),
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerTool: vi.fn(),
		registerCommand: vi.fn(),
		registerShortcut: vi.fn(),
		sendUserMessage: vi.fn(),
		appendEntry: vi.fn(),
	};
}

function makeMockCtx(hasUI = true) {
	return {
		hasUI,
		model: { provider: "anthropic", id: "claude-sonnet" },
		sessionManager: {
			getSessionDir: () => "/tmp/sessions",
			getSessionFile: () => "/tmp/sessions/s.jsonl",
			getEntries: () => [],
		},
		cwd: "/tmp/project",
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn(),
			setWidget: vi.fn(),
			theme: { fg: (_c: string, t: string) => t, bold: (t: string) => t },
		},
	};
}

async function fire(pi: ReturnType<typeof makeMockPI>, event: string, ...args: unknown[]) {
	for (const h of pi.handlers.get(event) ?? []) {
		await h(...args);
	}
}

// ── Tests ───────────────────────────────────────────────────────

let pi: ReturnType<typeof makeMockPI>;

beforeEach(() => {
	vi.clearAllMocks();
	mockShutdownAll.mockReset().mockResolvedValue();
	externalRegistrarMocks.load.mockResolvedValue([]);
	mockGetRecord.mockReturnValue({ task: undefined, sessionFile: "/tmp/s.jsonl" });
	pi = makeMockPI();
	piAgents(pi as unknown as Parameters<typeof piAgents>[0]);
});

describe("session_start", () => {
	it("loads workspace external peers before register → messaging.init", async () => {
		const order: string[] = [];
		externalRegistrarMocks.load.mockImplementation(async () => {
			order.push("loadExternalAgents");
			return [{ id: "ext-1", kind: "external" }];
		});
		mockSetExternalPeers.mockImplementation(() => order.push("setExternalPeers"));
		mockRegister.mockImplementation(() => order.push("register"));
		mockMessagingInit.mockImplementation(() => order.push("messaging.init"));
		mockReconcilerStart.mockImplementation(() => order.push("reconciler.start"));

		await fire(pi, "session_start", {}, makeMockCtx());

		expect(externalRegistrarMocks.load).toHaveBeenCalledWith({ workspaceRoot: "/tmp/project" });
		expect(order).toEqual([
			"setExternalPeers",
			"loadExternalAgents",
			"setExternalPeers",
			"register",
			"messaging.init",
			"reconciler.start",
		]);
	});

	it("starts UI when ctx.hasUI is true", async () => {
		await fire(pi, "session_start", {}, makeMockCtx(true));
		expect(mockUIStart).toHaveBeenCalled();
	});

	it("skips UI when ctx.hasUI is false", async () => {
		await fire(pi, "session_start", {}, makeMockCtx(false));
		expect(mockUIStart).not.toHaveBeenCalled();
	});
});

describe("agent events", () => {
	it("agent_start sets status to running", async () => {
		await fire(pi, "agent_start", {});
		expect(mockSetStatus).toHaveBeenCalledWith("running");
	});

	it("agent_end sets status to waiting and pokes pending", async () => {
		const order: string[] = [];
		mockSetStatus.mockImplementation(() => order.push("setStatus"));
		mockPokePending.mockImplementation(() => order.push("pokePending"));
		mockReconcilerOnAgentEnd.mockImplementation(() => order.push("reconciler.onAgentEnd"));

		await fire(pi, "agent_end", {});

		expect(order).toEqual(["setStatus", "pokePending", "reconciler.onAgentEnd"]);
		expect(mockSetStatus).toHaveBeenCalledWith("waiting");
	});

	it("model_select updates model string", async () => {
		await fire(pi, "model_select", { model: { provider: "openai", id: "gpt-5" } });
		expect(mockUpdateModel).toHaveBeenCalledWith("openai/gpt-5");
	});
});

describe("input", () => {
	it("sets task from first line of first input", async () => {
		mockGetRecord.mockReturnValue({ task: undefined, sessionFile: "/tmp/s.jsonl" });
		await fire(pi, "input", { text: "build a web app\nwith react" }, makeMockCtx());
		expect(mockSetTask).toHaveBeenCalledWith("build a web app");
	});

	it("does not overwrite existing task", async () => {
		mockGetRecord.mockReturnValue({ task: "already set", sessionFile: "/tmp/s.jsonl" });
		await fire(pi, "input", { text: "new task" }, makeMockCtx());
		expect(mockSetTask).not.toHaveBeenCalled();
	});

	it("returns continue action", async () => {
		const handlers = pi.handlers.get("input") ?? [];
		const result = await handlers[0]?.({ text: "hi" }, makeMockCtx());
		expect(result).toEqual({ action: "continue" });
	});
});

describe("session_shutdown", () => {
	it.each([true, false])("waits for children and drains their final peer messages (Hub first: %s)", async (hubFirst) => {
		pi = makeMockPI();
		const api = pi as unknown as Parameters<typeof piAgents>[0];
		for (const extension of hubFirst ? [piAgents, subagents] : [subagents, piAgents]) extension(api);
		const order: string[] = [];
		const inbox: string[] = [];
		const drained: string[] = [];
		let release = () => {};
		const childrenExiting = new Promise<void>((resolve) => { release = resolve; });
		mockShutdownAll.mockImplementation(async () => {
			order.push("children.stopping");
			await childrenExiting;
			inbox.push("DONE final peer message");
			order.push("children.stopped");
		});
		mockDrainAll.mockImplementation(() => { drained.push(...inbox); order.push("drainAll"); });
		mockMessagingDispose.mockImplementation(() => { order.push("dispose"); });
		channelMocks.unregisterChannel.mockImplementation(() => { order.push("channel-unregister"); });
		mockUnregister.mockImplementation(() => { order.push("unregister"); });

		const closing = fire(pi, "session_shutdown", {});
		expect(mockShutdownAll).toHaveBeenCalledOnce();
		expect(mockDrainAll).not.toHaveBeenCalled();
		expect(mockMessagingDispose).not.toHaveBeenCalled();
		expect(channelMocks.unregisterChannel).not.toHaveBeenCalled();
		expect(mockUnregister).not.toHaveBeenCalled();
		release();
		await closing;

		expect(mockShutdownAll).toHaveBeenCalledOnce();
		expect(order).toEqual(["children.stopping", "children.stopped", "drainAll", "dispose", "channel-unregister", "unregister"]);
		expect(drained).toEqual(["DONE final peer message"]);
		const pending: Promise<void>[] = [];
		const request: AgentChannelShutdown = { waitUntil: (work) => { pending.push(work); } };
		pi.events.emit(BEFORE_AGENT_CHANNEL_SHUTDOWN, request);
		expect(pending).toEqual([]); // No stale listener after shutdown/reload.
	});

	it("stops reconciliation → drainAll → dispose → ui.stop → unregister in order", async () => {
		const order: string[] = [];
		mockReconcilerStop.mockImplementation(() => { order.push("reconciler.stop"); });
		mockDrainAll.mockImplementation(() => { order.push("drainAll"); });
		mockMessagingDispose.mockImplementation(() => { order.push("dispose"); });
		channelMocks.unregisterChannel.mockImplementation(() => { order.push("channel-unregister"); });
		mockUIStop.mockImplementation(() => { order.push("ui.stop"); });
		mockUnregister.mockImplementation(() => { order.push("unregister"); });

		await fire(pi, "session_shutdown", {});

		expect(order).toEqual([
			"reconciler.stop",
			"drainAll",
			"dispose",
			"channel-unregister",
			"ui.stop",
			"unregister",
		]);
	});
});
