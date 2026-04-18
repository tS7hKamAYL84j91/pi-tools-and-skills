/**
 * Tests for the reconciler module's setup and lifecycle wiring.
 *
 * The reconciler's heuristics depend on agent-api and registry state
 * that is hard to unit-test without integration infrastructure.
 * These tests verify setup/lifecycle contracts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupReconciler } from "../extensions/pi-panopticon/reconciler.js";
import type { Registry } from "../extensions/pi-panopticon/types.js";
import type { OperationalStateStore } from "../extensions/pi-panopticon/state.js";

vi.mock("../../lib/agent-api.js", () => ({
	findAgentByName: vi.fn(() => null),
}));

function makeRegistry(): Registry {
	return {
		selfId: "self-id",
		getRecord: vi.fn(() => ({ id: "self-id", name: "test", pid: 1, cwd: "/tmp", model: "x", startedAt: 1, heartbeat: Date.now(), status: "waiting" as const })),
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

function makeStateStore(): OperationalStateStore {
	return {
		getState: vi.fn(() => undefined),
		restore: vi.fn(),
		recordInput: vi.fn(),
	} as unknown as OperationalStateStore;
}

function makeMockCtx() {
	return {
		isIdle: vi.fn(() => true),
		cwd: "/tmp",
		ui: { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn() },
		sessionManager: { getEntries: () => [], getSessionFile: () => "/tmp/s.jsonl" },
	};
}

describe("reconciler lifecycle", () => {
	let pi: { sendUserMessage: ReturnType<typeof vi.fn>; appendEntry: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		vi.useFakeTimers();
		pi = { sendUserMessage: vi.fn(), appendEntry: vi.fn() };
	});

	it("starts and stops without errors", () => {
		const reconciler = setupReconciler(pi as never, makeRegistry(), "self-id", makeStateStore());
		const ctx = makeMockCtx();
		reconciler.start(ctx as never);
		reconciler.stop();
	});

	it("resets consecutive injection counter on agent end", () => {
		const reconciler = setupReconciler(pi as never, makeRegistry(), "self-id", makeStateStore());
		const ctx = makeMockCtx();
		reconciler.start(ctx as never);
		reconciler.onAgentEnd();
		reconciler.stop();
	});

	it("does not inject when not idle", () => {
		const ctx = makeMockCtx();
		ctx.isIdle.mockReturnValue(false);
		const reconciler = setupReconciler(pi as never, makeRegistry(), "self-id", makeStateStore());
		reconciler.start(ctx as never);

		vi.advanceTimersByTime(120_000);

		expect(pi.sendUserMessage).not.toHaveBeenCalled();
		reconciler.stop();
	});

	afterEach(() => {
		vi.useRealTimers();
	});
});
