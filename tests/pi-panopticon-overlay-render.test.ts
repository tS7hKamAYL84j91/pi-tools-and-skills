/**
 * Narrow-width render coverage for pi-panopticon overlays.
 */

import { visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";

import {
	renderAgentDetailOverlay,
	renderAgentListOverlay,
} from "../extensions/pi-panopticon/agent-overlay.js";
import type { AgentRecord } from "../extensions/pi-panopticon/types.js";
import type { SessionEvent } from "../lib/session-log.js";

const fakeTheme = {
	fg: (_name: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as import("@mariozechner/pi-coding-agent").Theme;

function record(id: string, overrides: Partial<AgentRecord> = {}): AgentRecord {
	return {
		id,
		name: id,
		pid: 1234,
		cwd: `/tmp/${id}/with/a/deliberately/long/path/for/narrow/render/coverage`,
		model: "example-provider/example-model-with-a-long-name",
		startedAt: Date.now() - 120_000,
		heartbeat: Date.now(),
		status: "waiting",
		task: "Investigate terminal overlay behavior with a task summary that should wrap cleanly.",
		pendingMessages: 0,
		...overrides,
	};
}

function event(index: number): SessionEvent {
	return {
		ts: Date.UTC(2026, 4, 7, 12, index, 0),
		event: index % 3 === 0 ? "tool_result" : "message",
		role: "assistant",
		text: "A recent activity entry with enough content to document current bounded wrapping behavior in narrow overlays.",
		summary: "A long summary value that should remain bounded by the container render width even without scroll affordances.",
	};
}

function expectWidthBounded(lines: string[], width: number): void {
	for (const line of lines) {
		expect(visibleWidth(line)).toBeLessThanOrEqual(width);
	}
}

describe("pi-panopticon overlay renderers", () => {
	const records = [
		record("self", { status: "running" }),
		record("worker-one", { status: "blocked", pendingMessages: 2 }),
		record("worker-two", { status: "stalled" }),
	];

	for (const width of [80, 60]) {
		it(`renders the agent list within ${width} columns`, () => {
			const lines = renderAgentListOverlay({
				records,
				selfId: "self",
				theme: fakeTheme,
				width,
			});

			const body = lines.join("\n");
			expect(body).toContain("Agent Panopticon");
			expect(body).toContain("> R self (you)");
			expect(body).toContain("enter detail");
			expect(body).toContain("esc close");
			expectWidthBounded(lines, width);
		});

		it(`renders agent detail with long recent activity within ${width} columns`, () => {
			const workerOne = records[1];
			if (!workerOne) throw new Error("missing worker fixture");
			const sessionEvents = Array.from({ length: 20 }, (_unused, index) => event(index));
			const lines = renderAgentDetailOverlay({
				record: workerOne,
				selfId: "self",
				sessionEvents,
				theme: fakeTheme,
				width,
			});

			const body = lines.join("\n");
			expect(body).toContain("worker-one");
			expect(body).toContain("Recent Activity");
			expect(body).toContain("(20 events)");
			expect(body).toContain("... 5 earlier events omitted");
			expect(body).toContain("m send message");
			expectWidthBounded(lines, width);
		});
	}
});
