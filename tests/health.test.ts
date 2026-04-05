/**
 * Tests for agent health assessment (extensions/pi-panopticon/health.ts)
 *
 * Tests the pure functions: assessHealth, computeActivityHash,
 * detectApiErrors, agentSocketPath, and the status taxonomy logic.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRecord } from "../lib/agent-registry.js";

// Mock isPidAlive — control which PIDs are alive
vi.mock("../lib/agent-registry.js", async (importOriginal) => {
	const orig = await importOriginal<typeof import("../lib/agent-registry.js")>();
	return {
		...orig,
		isPidAlive: vi.fn(() => true),
	};
});

// Mock readSessionLog — control what activity events are returned
vi.mock("../lib/session-log.js", () => ({
	readSessionLog: vi.fn(() => []),
}));

import { isPidAlive } from "../lib/agent-registry.js";
import { readSessionLog } from "../lib/session-log.js";
import {
	assessHealth,
	computeActivityHash,
	detectApiErrors,
	agentSocketPath,
	// AgentHealthStatus used implicitly in status string comparisons
} from "../extensions/pi-panopticon/health.js";

const mockIsPidAlive = isPidAlive as ReturnType<typeof vi.fn>;
const mockReadSessionLog = readSessionLog as ReturnType<typeof vi.fn>;

// ── Fixtures ────────────────────────────────────────────────────

function makeRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
	return {
		id: "12345-abc",
		name: "test-agent",
		pid: 12345,
		cwd: "/tmp/test",
		model: "anthropic/claude-sonnet-4-6",
		startedAt: Date.now() - 60_000,
		heartbeat: Date.now() - 5_000,
		status: "running",
		pendingMessages: 0,
		sessionFile: "/tmp/test-session.jsonl",
		...overrides,
	};
}

function makeStallTracker(): Map<string, { lastHash: string; stallCount: number }> {
	return new Map();
}

// ── computeActivityHash ─────────────────────────────────────────

describe("computeActivityHash", () => {
	it("returns empty string when no session file", () => {
		expect(computeActivityHash(undefined)).toBe("");
	});

	it("returns empty string when no events", () => {
		mockReadSessionLog.mockReturnValue([]);
		expect(computeActivityHash("/tmp/session.jsonl")).toBe("");
	});

	it("returns a hash when events exist", () => {
		mockReadSessionLog.mockReturnValue([
			{ ts: 1000, event: "tool_call", tool: "bash" },
		]);
		const hash = computeActivityHash("/tmp/session.jsonl");
		expect(hash).toMatch(/^[a-f0-9]{32}$/);
	});

	it("returns different hashes for different events", () => {
		mockReadSessionLog.mockReturnValueOnce([
			{ ts: 1000, event: "tool_call", tool: "bash" },
		]);
		const hash1 = computeActivityHash("/tmp/a.jsonl");

		mockReadSessionLog.mockReturnValueOnce([
			{ ts: 2000, event: "tool_call", tool: "read" },
		]);
		const hash2 = computeActivityHash("/tmp/b.jsonl");

		expect(hash1).not.toBe(hash2);
	});
});

// ── detectApiErrors ─────────────────────────────────────────────

describe("detectApiErrors", () => {
	it("returns false when no session file", () => {
		expect(detectApiErrors(undefined)).toBe(false);
	});

	it("returns false when no tool_result events", () => {
		mockReadSessionLog.mockReturnValue([
			{ ts: 1000, event: "tool_call", tool: "bash" },
		]);
		expect(detectApiErrors("/tmp/s.jsonl")).toBe(false);
	});

	it("returns false when tool results are successful", () => {
		mockReadSessionLog.mockReturnValue([
			{ ts: 1000, event: "tool_result", tool: "bash", isError: false },
			{ ts: 2000, event: "tool_result", tool: "read", isError: false },
		]);
		expect(detectApiErrors("/tmp/s.jsonl")).toBe(false);
	});

	it("returns true when majority of tool results are errors", () => {
		mockReadSessionLog.mockReturnValue([
			{ ts: 1000, event: "tool_result", tool: "bash", isError: true },
			{ ts: 2000, event: "tool_result", tool: "bash", isError: true },
			{ ts: 3000, event: "tool_result", tool: "read", isError: false },
		]);
		expect(detectApiErrors("/tmp/s.jsonl")).toBe(true);
	});

	it("returns true when all tool results are errors", () => {
		mockReadSessionLog.mockReturnValue([
			{ ts: 1000, event: "tool_result", tool: "bash", isError: true },
		]);
		expect(detectApiErrors("/tmp/s.jsonl")).toBe(true);
	});

	it("returns false when minority of tool results are errors", () => {
		mockReadSessionLog.mockReturnValue([
			{ ts: 1000, event: "tool_result", tool: "bash", isError: true },
			{ ts: 2000, event: "tool_result", tool: "bash", isError: false },
			{ ts: 3000, event: "tool_result", tool: "read", isError: false },
		]);
		expect(detectApiErrors("/tmp/s.jsonl")).toBe(false);
	});
});

// ── agentSocketPath ─────────────────────────────────────────────

describe("agentSocketPath", () => {
	it("returns the conventional socket path", () => {
		const path = agentSocketPath("12345-abc");
		expect(path).toContain("12345-abc.sock");
		expect(path).toContain(".pi/agents");
	});
});

// ── assessHealth: terminated ────────────────────────────────────

describe("assessHealth — terminated", () => {
	it("returns terminated when PID is dead", () => {
		mockIsPidAlive.mockReturnValue(false);
		const record = makeRecord();
		const tracker = makeStallTracker();

		const h = assessHealth(record, tracker);
		expect(h.status).toBe("terminated");
		expect(h.alive).toBe(false);
	});

	it("clears stall tracker for terminated agents", () => {
		mockIsPidAlive.mockReturnValue(false);
		const record = makeRecord();
		const tracker = makeStallTracker();
		tracker.set(record.id, { lastHash: "abc", stallCount: 5 });

		assessHealth(record, tracker);
		expect(tracker.has(record.id)).toBe(false);
	});
});

// ── assessHealth: blocked ───────────────────────────────────────

describe("assessHealth — blocked", () => {
	it("returns blocked when agent self-reports blocked", () => {
		mockIsPidAlive.mockReturnValue(true);
		const record = makeRecord({ status: "blocked" });
		const h = assessHealth(record, makeStallTracker());
		expect(h.status).toBe("blocked");
	});
});

// ── assessHealth: waiting ───────────────────────────────────────

describe("assessHealth — waiting", () => {
	it("returns waiting when agent is idle", () => {
		mockIsPidAlive.mockReturnValue(true);
		const record = makeRecord({ status: "waiting" });
		const h = assessHealth(record, makeStallTracker());
		expect(h.status).toBe("waiting");
	});

	it("clears stall tracker when waiting", () => {
		mockIsPidAlive.mockReturnValue(true);
		const record = makeRecord({ status: "waiting" });
		const tracker = makeStallTracker();
		tracker.set(record.id, { lastHash: "abc", stallCount: 3 });

		assessHealth(record, tracker);
		expect(tracker.has(record.id)).toBe(false);
	});
});

// ── assessHealth: api_error ─────────────────────────────────────

describe("assessHealth — api_error", () => {
	it("returns api_error when recent activity has errors", () => {
		mockIsPidAlive.mockReturnValue(true);
		mockReadSessionLog.mockReturnValue([
			{ ts: 1000, event: "tool_result", tool: "bash", isError: true },
			{ ts: 2000, event: "tool_result", tool: "bash", isError: true },
		]);
		const record = makeRecord({ status: "running" });
		const h = assessHealth(record, makeStallTracker());
		expect(h.status).toBe("api_error");
	});
});

// ── assessHealth: stall detection (sleep-aware) ─────────────────

describe("assessHealth — stall detection", () => {
	beforeEach(() => {
		mockIsPidAlive.mockReturnValue(true);
		// Return consistent events so hash doesn't change between calls
		mockReadSessionLog.mockReturnValue([
			{ ts: 1000, event: "tool_call", tool: "bash" },
		]);
	});

	it("returns active on first call (no prior hash)", () => {
		const record = makeRecord({ status: "running" });
		const tracker = makeStallTracker();
		const h = assessHealth(record, tracker);
		expect(h.status).toBe("active");
		expect(h.stallCycles).toBe(0);
	});

	it("increments stall count on unchanged activity", () => {
		const record = makeRecord({ status: "running" });
		const tracker = makeStallTracker();

		// First call — establishes baseline
		assessHealth(record, tracker);

		// Second call — same hash
		const h2 = assessHealth(record, tracker);
		expect(h2.stallCycles).toBe(1);
		expect(h2.status).toBe("active"); // below threshold
	});

	it("returns stalled after reaching threshold with stale heartbeat", () => {
		const record = makeRecord({
			status: "running",
			heartbeat: Date.now() - 120_000, // 2 minutes ago — stale
		});
		const tracker = makeStallTracker();

		// Build up stall cycles
		assessHealth(record, tracker); // cycle 0 (baseline)
		assessHealth(record, tracker); // cycle 1
		assessHealth(record, tracker); // cycle 2
		const h = assessHealth(record, tracker); // cycle 3 — at threshold

		expect(h.stallCycles).toBe(3);
		expect(h.status).toBe("stalled");
	});

	it("returns sleeping when threshold reached but heartbeat is fresh", () => {
		const record = makeRecord({
			status: "running",
			heartbeat: Date.now() - 5_000, // 5 seconds ago — fresh
		});
		const tracker = makeStallTracker();

		assessHealth(record, tracker); // baseline
		assessHealth(record, tracker); // cycle 1
		assessHealth(record, tracker); // cycle 2
		const h = assessHealth(record, tracker); // cycle 3

		expect(h.stallCycles).toBe(3);
		expect(h.status).toBe("sleeping");
	});

	it("resets stall count when activity changes", () => {
		const record = makeRecord({ status: "running" });
		const tracker = makeStallTracker();

		// First call
		assessHealth(record, tracker);

		// Same hash
		assessHealth(record, tracker);
		expect(tracker.get(record.id)?.stallCount).toBe(1);

		// New activity
		mockReadSessionLog.mockReturnValue([
			{ ts: 3000, event: "tool_call", tool: "read" },
		]);
		const h = assessHealth(record, tracker);
		expect(h.stallCycles).toBe(0);
		expect(h.status).toBe("active");
	});

	it("respects custom stall threshold", () => {
		const record = makeRecord({
			status: "running",
			heartbeat: Date.now() - 120_000,
		});
		const tracker = makeStallTracker();

		assessHealth(record, tracker, 2); // baseline
		assessHealth(record, tracker, 2); // cycle 1
		const h = assessHealth(record, tracker, 2); // cycle 2 — at threshold=2

		expect(h.stallCycles).toBe(2);
		expect(h.status).toBe("stalled");
	});
});

// ── assessHealth: priority ordering ─────────────────────────────

describe("assessHealth — status priority", () => {
	it("terminated takes priority over everything", () => {
		mockIsPidAlive.mockReturnValue(false);
		const record = makeRecord({ status: "blocked" });
		const h = assessHealth(record, makeStallTracker());
		expect(h.status).toBe("terminated");
	});

	it("blocked takes priority over api_error", () => {
		mockIsPidAlive.mockReturnValue(true);
		mockReadSessionLog.mockReturnValue([
			{ ts: 1, event: "tool_result", tool: "x", isError: true },
		]);
		const record = makeRecord({ status: "blocked" });
		const h = assessHealth(record, makeStallTracker());
		expect(h.status).toBe("blocked");
	});

	it("api_error takes priority over stall detection", () => {
		mockIsPidAlive.mockReturnValue(true);
		mockReadSessionLog.mockReturnValue([
			{ ts: 1, event: "tool_result", tool: "x", isError: true },
			{ ts: 2, event: "tool_result", tool: "y", isError: true },
		]);
		const record = makeRecord({ status: "running" });
		const tracker = makeStallTracker();
		// Even with stall history, api_error wins
		tracker.set(record.id, { lastHash: "old", stallCount: 10 });
		const h = assessHealth(record, tracker);
		expect(h.status).toBe("api_error");
	});
});

// ── assessHealth: structured output ─────────────────────────────

describe("assessHealth — output structure", () => {
	it("includes all required fields", () => {
		mockIsPidAlive.mockReturnValue(true);
		mockReadSessionLog.mockReturnValue([]);
		const record = makeRecord({
			model: "anthropic/claude-sonnet-4-6",
			pendingMessages: 3,
		});
		const h = assessHealth(record, makeStallTracker());

		expect(h).toHaveProperty("name", "test-agent");
		expect(h).toHaveProperty("pid", 12345);
		expect(h).toHaveProperty("alive", true);
		expect(h).toHaveProperty("status");
		expect(h).toHaveProperty("heartbeatAge");
		expect(h.heartbeatAge).toBeGreaterThanOrEqual(0);
		expect(h).toHaveProperty("stallCycles");
		expect(h).toHaveProperty("model", "anthropic/claude-sonnet-4-6");
		expect(h).toHaveProperty("pendingMessages", 3);
		expect(h).toHaveProperty("socket");
		expect(h.socket).toContain(".sock");
	});
});
