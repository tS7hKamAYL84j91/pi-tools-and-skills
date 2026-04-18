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
			getRecord = mockGetRecord;
			flush = mockFlush;
			readAllPeers = mockReadAllPeers;
		},
	};
});

const mockMessagingInit = vi.fn();
const mockDrainInbox = vi.fn();
const mockMessagingDispose = vi.fn();

vi.mock("../extensions/pi-panopticon/messaging.js", () => ({
	default: vi.fn(() => ({ init: mockMessagingInit, drainInbox: mockDrainInbox, dispose: mockMessagingDispose })),
}));

const mockShutdownAll = vi.fn(async () => {});

const mockOnMissingDone = vi.fn(() => () => {});

vi.mock("../extensions/pi-panopticon/spawner.js", () => ({
	setupSpawner: vi.fn(() => ({ shutdownAll: mockShutdownAll, onMissingDone: mockOnMissingDone })),
}));

vi.mock("../extensions/pi-panopticon/peek.js", () => ({
	setupPeek: vi.fn(),
}));

const mockReconcilerStart = vi.fn();
const mockReconcilerStop = vi.fn();
const mockReconcilerOnAgentEnd = vi.fn();

vi.mock("../extensions/pi-panopticon/reconciler.js", () => ({
	setupReconciler: vi.fn(() => ({ start: mockReconcilerStart, stop: mockReconcilerStop, onAgentEnd: mockReconcilerOnAgentEnd })),
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
	mockGetRecord.mockReturnValue({ task: undefined, sessionFile: "/tmp/s.jsonl" });
	pi = makeMockPI();
	piAgents(pi as unknown as Parameters<typeof piAgents>[0]);
});

describe("session_start", () => {
	it("calls register → messaging.init in order", async () => {
		const order: string[] = [];
		mockRegister.mockImplementation(() => order.push("register"));
		mockMessagingInit.mockImplementation(() => order.push("messaging.init"));
		mockReconcilerStart.mockImplementation(() => order.push("reconciler.start"));

		await fire(pi, "session_start", {}, makeMockCtx());

		expect(order).toEqual(["register", "messaging.init", "reconciler.start"]);
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
		mockReconcilerOnAgentEnd.mockImplementation(() => order.push("reconciler.onAgentEnd"));

		await fire(pi, "agent_end", {});

		expect(order).toEqual(["setStatus", "drainInbox", "reconciler.onAgentEnd"]);
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
	it("calls shutdownAll → drainInbox → dispose → ui.stop → unregister in order", async () => {
		const order: string[] = [];
		mockShutdownAll.mockImplementation(async () => { order.push("shutdownAll"); });
		mockReconcilerStop.mockImplementation(() => { order.push("reconciler.stop"); });
		mockDrainInbox.mockImplementation(() => { order.push("drainInbox"); });
		mockMessagingDispose.mockImplementation(() => { order.push("dispose"); });
		mockUIStop.mockImplementation(() => { order.push("ui.stop"); });
		mockUnregister.mockImplementation(() => { order.push("unregister"); });

		await fire(pi, "session_shutdown", {});

		expect(order).toEqual(["shutdownAll", "reconciler.stop", "drainInbox", "dispose", "ui.stop", "unregister"]);
	});
});
