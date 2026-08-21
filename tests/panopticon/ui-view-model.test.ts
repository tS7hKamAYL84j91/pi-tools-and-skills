import { describe, expect, it } from "vitest";

import {
	buildAgentDetailRows,
	formatActivityExtra,
	getActivityColor,
	getActivityWindow,
} from "../../extensions/pi-panopticon/ui/agent-detail-model.js";
import { summarizeAgentStatus } from "../../extensions/pi-panopticon/ui/status-view-model.js";
import type { AgentRecord } from "../../extensions/pi-panopticon/types.js";
import type { SessionEvent } from "../../lib/session-log.js";

function record(id: string, status: AgentRecord["status"], overrides: Partial<AgentRecord> = {}): AgentRecord {
	return {
		id,
		name: id,
		pid: 42,
		cwd: "/tmp/work",
		model: "provider/model",
		startedAt: 1,
		heartbeat: 1,
		status,
		...overrides,
	};
}

function event(index: number): SessionEvent {
	return { ts: index, event: `event-${index}`, detail: "x" };
}

describe("agent detail view model", () => {
	it("builds stable detail rows and bounds the task value", () => {
		const rows = buildAgentDetailRows(record("worker", "waiting", {
			model: "",
			pendingMessages: 3,
			task: "123456789012345678901234567890123456789012345678901234567890-extra",
		}), "2m");

		expect(rows).toEqual([
			{ label: "Model", value: "unknown" },
			{ label: "CWD", value: "/tmp/work" },
			{ label: "PID", value: "42" },
			{ label: "Messages", value: "msg:3" },
			{ label: "Uptime", value: "2m" },
			{ label: "Task", value: "123456789012345678901234567890123456789012345678901234567890" },
		]);
	});

	it("keeps only the latest activity entries", () => {
		const events = Array.from({ length: 17 }, (_value, index) => event(index));
		expect(getActivityWindow(events)).toEqual({
			visibleEvents: events.slice(2),
			hiddenCount: 2,
		});
		expect(formatActivityExtra({ ts: 1, event: "error", detail: "failure", count: 2 })).toBe("detail=failure count=2");
	});

	it.each([
		["tool_error", "error"],
		["session_start", "success"],
		["session_end", "warning"],
		["message", "dim"],
	] as const)("maps %s activity to %s", (eventName, color) => {
		expect(getActivityColor(eventName)).toBe(color);
	});
});

describe("agent status view model", () => {
	it.each([
		[[], "solo"],
		[[record("worker", "done")], "1 peer"],
		[[record("one", "running"), record("two", "waiting")], "active:1 idle:1"],
		[[record("one", "blocked"), record("two", "stalled")], "2 peers"],
	] as const)("summarizes %s as %s", (peers, label) => {
		const summary = summarizeAgentStatus([record("self", "running"), ...peers], "self");
		expect(summary.label).toBe(label);
		expect(summary.peerCount).toBe(peers.length);
	});
});
