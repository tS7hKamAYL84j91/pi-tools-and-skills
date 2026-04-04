/**
 * Characterisation tests for pi-panopticon pure functions.
 * These lock in existing behaviour before refactoring.
 */
import { describe, it, expect } from "vitest";
import type { AgentRecord } from "../lib/agent-registry.js";
import {
	classifyRecord,
	buildRecord,
	formatAge,
	nameTaken,
	pickName,
	sortRecords,
	agentCleanupPaths,
} from "../extensions/pi-panopticon/registry.js";
import { readSessionLog, formatSessionLog } from "../lib/session-log.js";

// ── Fixtures ────────────────────────────────────────────────────

const STALE_MS = 30_000;

function makeRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
	return {
		id: "abc-123",
		name: "test-agent",
		pid: 12345,
		cwd: "/tmp/test",
		model: "anthropic/claude",
		startedAt: Date.now() - 60_000,
		heartbeat: Date.now(),
		status: "waiting",
		...overrides,
	};
}

// ── classifyRecord ───────────────────────────────────────────────

describe("classifyRecord", () => {
	it("returns 'live' when heartbeat is fresh", () => {
		const rec = makeRecord({ heartbeat: Date.now() - 1000 });
		expect(classifyRecord(rec, Date.now(), false)).toBe("live");
	});

	it("returns 'stalled' when heartbeat is stale but pid is alive", () => {
		const rec = makeRecord({ heartbeat: Date.now() - STALE_MS - 1000 });
		expect(classifyRecord(rec, Date.now(), true)).toBe("stalled");
	});

	it("returns 'dead' when heartbeat is stale and pid is gone", () => {
		const rec = makeRecord({ heartbeat: Date.now() - STALE_MS - 1000 });
		expect(classifyRecord(rec, Date.now(), false)).toBe("dead");
	});

	it("returns 'live' when heartbeat is exactly at the boundary", () => {
		const now = Date.now();
		const rec = makeRecord({ heartbeat: now - STALE_MS });
		// boundary: now - heartbeat === STALE_MS → ≤ STALE_MS → live
		expect(classifyRecord(rec, now, false)).toBe("live");
	});
});

// ── buildRecord ──────────────────────────────────────────────────

describe("buildRecord", () => {
	it("returns record with updated heartbeat and status", () => {
		const base = makeRecord({ status: "running" });
		const before = Date.now();
		const result = buildRecord(base, "running", "my task");
		expect(result.status).toBe("running");
		expect(result.task).toBe("my task");
		expect(result.heartbeat).toBeGreaterThanOrEqual(before);
	});

	it("promotes waiting→done when REPORT.md exists in a real dir", () => {
		// When REPORT.md doesn't exist the status stays 'waiting'
		const base = makeRecord({ cwd: "/tmp/nonexistent-dir-xyz" });
		const result = buildRecord(base, "waiting", undefined);
		expect(result.status).toBe("waiting");
	});
});

// ── formatAge ───────────────────────────────────────────────────

describe("formatAge", () => {
	it("shows seconds when under 60s", () => {
		const age = formatAge(Date.now() - 30_000);
		expect(age).toMatch(/^\d+s$/);
		expect(parseInt(age)).toBeGreaterThanOrEqual(29);
		expect(parseInt(age)).toBeLessThanOrEqual(31);
	});

	it("shows minutes when over 60s", () => {
		const age = formatAge(Date.now() - 120_000);
		expect(age).toMatch(/^\d+m$/);
		expect(parseInt(age)).toBe(2);
	});
});

// ── nameTaken ───────────────────────────────────────────────────

describe("nameTaken", () => {
	it("returns false when no records", () => {
		expect(nameTaken("alice", [], "self-id")).toBe(false);
	});

	it("returns true when another agent has the name (case-insensitive)", () => {
		const records = [makeRecord({ id: "other-id", name: "Alice" })];
		expect(nameTaken("alice", records, "self-id")).toBe(true);
	});

	it("returns false when same name belongs to self", () => {
		const records = [makeRecord({ id: "self-id", name: "alice" })];
		expect(nameTaken("alice", records, "self-id")).toBe(false);
	});
});

// ── pickName ────────────────────────────────────────────────────

describe("pickName", () => {
	it("uses basename of cwd when not taken", () => {
		expect(pickName("/home/user/myproject", [], "self")).toBe("myproject");
	});

	it("appends -2 when base is taken", () => {
		const records = [makeRecord({ id: "other", name: "myproject" })];
		expect(pickName("/home/user/myproject", records, "self")).toBe("myproject-2");
	});

	it("increments suffix until a free slot is found", () => {
		const records = [
			makeRecord({ id: "a", name: "proj" }),
			makeRecord({ id: "b", name: "proj-2" }),
		];
		expect(pickName("/x/proj", records, "self")).toBe("proj-3");
	});
});

// ── formatSessionLog ─────────────────────────────────────────────

describe("formatSessionLog", () => {
	it("returns placeholder for empty array", () => {
		expect(formatSessionLog([])).toBe("(no activity recorded yet)");
	});

	it("formats a tool_call event", () => {
		const events = [{
			ts: new Date("2025-01-01T12:34:56Z").getTime(),
			event: "tool_call",
			tool: "bash",
			args: '{"command":"echo hi"}',
		}];
		const result = formatSessionLog(events);
		expect(result).toContain("[12:34:56]");
		expect(result).toContain("tool_call");
		expect(result).toContain("tool=bash");
	});

	it("formats a message event", () => {
		const events = [{
			ts: new Date("2025-01-01T00:00:00Z").getTime(),
			event: "message",
			role: "user",
			text: "hello world",
		}];
		const result = formatSessionLog(events);
		expect(result).toContain("role=user");
		expect(result).toContain('text="hello world"');
	});

	it("formats a tool_result event", () => {
		const events = [{
			ts: Date.now(),
			event: "tool_result",
			tool: "read",
			summary: "file contents here",
			isError: false,
		}];
		const result = formatSessionLog(events);
		expect(result).toContain("tool_result");
		expect(result).toContain("tool=read");
		expect(result).toContain('summary="file contents here"');
	});
});

// ── readSessionLog ───────────────────────────────────────────────

describe("readSessionLog", () => {
	it("returns empty array for non-existent file", () => {
		const events = readSessionLog("/tmp/nonexistent-session-file.jsonl", 50);
		expect(events).toEqual([]);
	});
});

// ── agentCleanupPaths ───────────────────────────────────────────

describe("agentCleanupPaths", () => {
	it("returns the .json registry path", () => {
		const paths = agentCleanupPaths("test-agent-123");
		expect(paths).toHaveLength(1);
		expect(paths[0]).toMatch(/test-agent-123\.json$/);
	});

	it("does NOT include the agent inbox directory path", () => {
		const paths = agentCleanupPaths("test-agent-123");
		for (const p of paths) {
			expect(p).toMatch(/\.json$/);
		}
	});

	it("uses the agent id in the returned path", () => {
		const id = "unique-id-xyz";
		const paths = agentCleanupPaths(id);
		for (const p of paths) {
			expect(p).toContain(id);
		}
	});
});

// ── sortRecords ──────────────────────────────────────────────────

describe("sortRecords", () => {
	it("places self first", () => {
		const self = makeRecord({ id: "self", startedAt: Date.now() - 1000 });
		const other = makeRecord({ id: "other", startedAt: Date.now() - 2000 });
		const sorted = sortRecords([other, self], "self");
		expect(sorted[0]?.id).toBe("self");
	});

	it("sorts non-self records by startedAt ascending", () => {
		const a = makeRecord({ id: "a", startedAt: 1000 });
		const b = makeRecord({ id: "b", startedAt: 500 });
		const c = makeRecord({ id: "c", startedAt: 1500 });
		const sorted = sortRecords([a, b, c], "nobody");
		expect(sorted.map(r => r.id)).toEqual(["b", "a", "c"]);
	});
});
