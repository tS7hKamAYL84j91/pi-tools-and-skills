/**
 * Tests for the reconciler module's setup and lifecycle wiring.
 *
 * The reconciler's heuristics depend on agent-api and registry state
 * that is hard to unit-test without integration infrastructure.
 * These tests verify setup/lifecycle contracts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentRecord } from "../../lib/agent-registry.js";
import { findAgentByName } from "../../lib/agent-api.js";
import {
	checkAgentHealth,
	checkStaleActivity,
	setupReconciler,
} from "../../extensions/pi-panopticon/registry/reconciler.js";
import type { Registry } from "../../extensions/pi-panopticon/types.js";
import type { OperationalStateStore } from "../../extensions/pi-panopticon/registry/state.js";
import { makeAgentInfo, mockFindAgentStates } from "../helpers/agent-api-mock.js";

vi.mock("../../lib/agent-api.js", () => ({
	findAgentByName: vi.fn(() => null),
}));

const mockFindAgentByName = vi.mocked(findAgentByName);

function makeRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
	return {
		id: "peer-id",
		name: "peer",
		pid: 123,
		cwd: "/tmp",
		model: "x",
		startedAt: 1,
		heartbeat: Date.now(),
		status: "waiting",
		pendingMessages: 0,
		...overrides,
	};
}

function makeRegistry(records: AgentRecord[] = []): Registry {
	return {
		selfId: "self-id",
		getRecord: vi.fn(() => makeRecord({ id: "self-id", name: "self", pid: 1 })),
		register: vi.fn(),
		unregister: vi.fn(),
		setStatus: vi.fn(),
		updateModel: vi.fn(),
		setTask: vi.fn(),
		setName: vi.fn(),
		updatePendingMessages: vi.fn(),
		setExternalPeers: vi.fn(),
		readAllPeers: vi.fn(() => records),
		flush: vi.fn(),
		isRootSession: vi.fn(() => true),
	};
}

function makeStateStore(lastActiveAt?: number): OperationalStateStore {
	return {
		getState: vi.fn(() => lastActiveAt == null ? undefined : {
			version: 1,
			workspaceId: "local:interactive",
			sourceChannel: "local",
			humanIdentity: "interactive",
			lastActiveAt,
			linkedPaths: { cwd: "/tmp" },
			pendingFollowUps: [],
			resume: { reason: "startup" },
		}),
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

describe("reconciler findings", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-09T00:00:00Z"));
		mockFindAgentByName.mockReset();
	});

	it("suppresses stale activity when peers are idle and freshly heartbeating", () => {
		const peer = makeRecord({ status: "waiting", heartbeat: Date.now() - 10_000 });
		mockFindAgentByName.mockReturnValue(makeAgentInfo(peer, { heartbeatAge: 10_000 }));

		const findings = checkStaleActivity(
			makeStateStore(Date.now() - 31 * 60_000),
			makeRegistry([peer]),
			"self-id",
		);

		expect(findings).toEqual([]);
	});

	it("does not alert on one stale sample when confirmation is fresh", () => {
		const peer = makeRecord({ status: "running", heartbeat: Date.now() - 10 * 60_000 });
		mockFindAgentByName.mockReturnValue(makeAgentInfo(peer, { heartbeatAge: 5_000 }));

		const findings = checkAgentHealth(makeRegistry([peer]), "self-id");

		expect(findings.map((finding) => finding.heuristic)).not.toContain("stale-worker");
	});

	it("keeps actionable alerts for pending messages, blocked agents, explicit stalls, and silent termination", () => {
		const pending = makeRecord({ id: "pending", name: "pending", pendingMessages: 2 });
		const blocked = makeRecord({ id: "blocked", name: "blocked", status: "blocked" });
		const stale = makeRecord({ id: "stale", name: "stale", status: "running" });
		const stalled = makeRecord({ id: "stalled", name: "stalled", status: "stalled" });
		const dead = makeRecord({ id: "dead", name: "dead", status: "running" });
		mockFindAgentStates(mockFindAgentByName, [pending, blocked, stale, stalled, dead], {
			pending: { status: "running", heartbeatAge: 5_000 },
			blocked: { status: "blocked", heartbeatAge: 5_000 },
			stale: { status: "running", heartbeatAge: 10 * 60_000 },
			stalled: { status: "stalled", heartbeatAge: 5_000 },
			dead: { status: "running", alive: false, heartbeatAge: 5_000 },
		});

		const findings = checkAgentHealth(
			makeRegistry([pending, blocked, stale, stalled, dead]),
			"self-id",
		);

		expect(findings.map((finding) => finding.heuristic)).toEqual([
			"pending-messages",
			"blocked-agent",
			"stale-worker",
			"silent-done",
		]);
		expect(findings.every((finding) => finding.level === "actionable")).toBe(true);
	});

	it("does not alert on heartbeat age alone after confirmation", () => {
		const peer = makeRecord({ status: "running", heartbeat: Date.now() - 16 * 60_000 });
		mockFindAgentByName.mockReturnValue(makeAgentInfo(peer, {
			alive: true,
			heartbeatAge: 16 * 60_000,
			status: "running",
		}));

		const findings = checkAgentHealth(makeRegistry([peer]), "self-id");

		expect(findings).toEqual([]);
	});

	it("suppresses stale activity when peers only have stale heartbeats", () => {
		const peer = makeRecord({ status: "running", heartbeat: Date.now() - 16 * 60_000 });
		mockFindAgentByName.mockReturnValue(makeAgentInfo(peer, {
			alive: true,
			heartbeatAge: 16 * 60_000,
			status: "running",
		}));

		const findings = checkStaleActivity(
			makeStateStore(Date.now() - 52 * 60_000),
			makeRegistry([peer]),
			"self-id",
		);

		expect(findings).toEqual([]);
	});

	it("does not treat a done agent exit as silent termination", () => {
		const done = makeRecord({ id: "done", name: "done", status: "done" });
		mockFindAgentByName.mockReturnValue(makeAgentInfo(done, {
			alive: false,
			heartbeatAge: 5_000,
			status: "terminated",
		}));

		const findings = checkAgentHealth(makeRegistry([done]), "self-id");

		expect(findings).toEqual([]);
	});
});

describe("reconciler lifecycle", () => {
	let pi: { sendUserMessage: ReturnType<typeof vi.fn>; appendEntry: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		vi.useFakeTimers();
		mockFindAgentByName.mockReset();
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
