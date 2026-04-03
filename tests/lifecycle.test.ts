/**
 * Integration tests for extensions/pi-panopticon/index.ts lifecycle wiring.
 *
 * Verifies that the orchestrator calls modules in the correct order
 * during session_start, agent events, and session_shutdown.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock all modules before import ──────────────────────────────

const mockRegister = vi.fn();
const mockUnregister = vi.fn();
const mockSetStatus = vi.fn();
const mockUpdateModel = vi.fn();
const mockSetTask = vi.fn();
const mockSetSocket = vi.fn();
const mockGetRecord = vi.fn((): { task: string | undefined; sessionFile: string } => ({ task: undefined, sessionFile: "/tmp/s.jsonl" }));
const mockFlush = vi.fn();
const mockReadAllPeers = vi.fn(() => []);

vi.mock("../extensions/pi-panopticon/registry.js", () => {
	return {
		default: class MockRegistry {
			selfId = "test-id";
			register = mockRegister;
			unregister = mockUnregister;
			setStatus = mockSetStatus;
			updateModel = mockUpdateModel;
			setTask = mockSetTask;
			setSocket = mockSetSocket;
			getRecord = mockGetRecord;
			flush = mockFlush;
			readAllPeers = mockReadAllPeers;
		},
	};
});

const mockSocketStart = vi.fn();
const mockSocketStop = vi.fn();
const mockSocketIsRunning = vi.fn(() => true);

vi.mock("../extensions/pi-panopticon/socket.js", () => {
	return {
		default: class MockSocketServer {
			start = mockSocketStart;
			stop = mockSocketStop;
			isRunning = mockSocketIsRunning;
		},
	};
});

const mockMessagingInit = vi.fn();
const mockDrainInbox = vi.fn();

vi.mock("../extensions/pi-panopticon/messaging.js", () => ({
	default: vi.fn(() => ({ init: mockMessagingInit, drainInbox: mockDrainInbox })),
}));

const mockShutdownAll = vi.fn(async () => {});

vi.mock("../extensions/pi-panopticon/spawner.js", () => ({
	setupSpawner: vi.fn(() => ({ shutdownAll: mockShutdownAll })),
}));

vi.mock("../extensions/pi-panopticon/peek.js", () => ({
	setupPeek: vi.fn(),
}));

const mockUIStart = vi.fn();
const mockUIStop = vi.fn();

vi.mock("../extensions/pi-panopticon/ui.js", () => ({
	setupUI: vi.fn(() => ({ start: mockUIStart, stop: mockUIStop, refresh: vi.fn() })),
}));

import piAgents from "../extensions/pi-panopticon/index.js";

// ── Mock ExtensionAPI ───────────────────────────────────────────

type Handler = (...args: unknown[]) => Promise<unknown>;

function makeMockPI() {
	const handlers = new Map<string, Handler[]>();
	return {
		handlers,
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerTool: vi.fn(),
		registerCommand: vi.fn(),
		registerShortcut: vi.fn(),
		sendUserMessage: vi.fn(),
	};
}

function makeMockCtx(hasUI = true) {
	return {
		hasUI,
		model: { provider: "anthropic", id: "claude-sonnet" },
		sessionManager: {
			getSessionDir: () => "/tmp/sessions",
			getSessionFile: () => "/tmp/sessions/s.jsonl",
		},
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
	mockGetRecord.mockReturnValue({ task: undefined, sessionFile: "/tmp/s.jsonl" });
	pi = makeMockPI();
	piAgents(pi as unknown as Parameters<typeof piAgents>[0]);
});

describe("session_start", () => {
	it("calls register → socket.start → messaging.init in order", async () => {
		const order: string[] = [];
		mockRegister.mockImplementation(() => order.push("register"));
		mockSocketStart.mockImplementation(() => order.push("socket.start"));
		mockMessagingInit.mockImplementation(() => order.push("messaging.init"));

		await fire(pi, "session_start", {}, makeMockCtx());

		expect(order).toEqual(["register", "socket.start", "messaging.init"]);
	});

	it("sets socket path on registry when socket is running", async () => {
		mockSocketIsRunning.mockReturnValue(true);
		await fire(pi, "session_start", {}, makeMockCtx());
		expect(mockSetSocket).toHaveBeenCalledWith(expect.stringContaining(".sock"));
	});

	it("sets socket undefined when socket fails to start", async () => {
		mockSocketIsRunning.mockReturnValue(false);
		await fire(pi, "session_start", {}, makeMockCtx());
		expect(mockSetSocket).toHaveBeenCalledWith(undefined);
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

	it("agent_end sets status to waiting and drains inbox", async () => {
		const order: string[] = [];
		mockSetStatus.mockImplementation(() => order.push("setStatus"));
		mockDrainInbox.mockImplementation(() => order.push("drainInbox"));

		await fire(pi, "agent_end", {});

		expect(order).toEqual(["setStatus", "drainInbox"]);
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
		await fire(pi, "input", { text: "build a web app\nwith react" });
		expect(mockSetTask).toHaveBeenCalledWith("build a web app");
	});

	it("does not overwrite existing task", async () => {
		mockGetRecord.mockReturnValue({ task: "already set", sessionFile: "/tmp/s.jsonl" });
		await fire(pi, "input", { text: "new task" });
		expect(mockSetTask).not.toHaveBeenCalled();
	});

	it("returns continue action", async () => {
		const handlers = pi.handlers.get("input") ?? [];
		const result = await handlers[0]?.({ text: "hi" });
		expect(result).toEqual({ action: "continue" });
	});
});

describe("session_shutdown", () => {
	it("calls shutdownAll → drainInbox → socket.stop → ui.stop → unregister in order", async () => {
		const order: string[] = [];
		mockShutdownAll.mockImplementation(async () => { order.push("shutdownAll"); });
		mockDrainInbox.mockImplementation(() => { order.push("drainInbox"); });
		mockSocketStop.mockImplementation(() => { order.push("socket.stop"); });
		mockUIStop.mockImplementation(() => { order.push("ui.stop"); });
		mockUnregister.mockImplementation(() => { order.push("unregister"); });

		await fire(pi, "session_shutdown", {});

		expect(order).toEqual(["shutdownAll", "drainInbox", "socket.stop", "ui.stop", "unregister"]);
	});
});
