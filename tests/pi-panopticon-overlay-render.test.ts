/**
 * Narrow-width render coverage for pi-panopticon overlays.
 */

import { visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";

import { renderAgentMessageOverlay } from "../extensions/pi-panopticon/agent-message-overlay.js";
import {
	renderAgentDetailOverlay,
	renderAgentListOverlay,
	sortAgentOverlayRecords,
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
			expect(body).toContain("unread first");
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
			expect(body).toContain("c direct message");
			expect(body).toContain("m send message");
			expect(body).toContain("s stop");
			expect(body).toContain("k kill");
			expectWidthBounded(lines, width);
		});

		it(`renders agent direct-message status within ${width} columns`, () => {
			const workerOne = records[1];
			if (!workerOne) throw new Error("missing worker fixture");
			const lines = renderAgentMessageOverlay({
				record: workerOne,
				entries: [
					{ kind: "you", text: "Please summarize your current state and tell me if you are blocked on anything before continuing." },
					{ kind: "system", text: "sent (1234-message-reference-with-a-long-name.json)" },
					{ kind: "error", text: "Agent \"worker-one\" is no longer visible." },
				],
				sending: false,
				theme: fakeTheme,
				width,
			});

			const body = lines.join("\n");
			expect(body).toContain("Message worker-one");
			expect(body).toContain("Replies arrive through normal");
			expect(body).toContain("unread messages");
			expect(body).toContain("error:");
			expect(body).toContain("enter send");
			expectWidthBounded(lines, width);
		});
	}

	it("sorts unread-message agents ahead of other peers while keeping self first", () => {
		const ordered = sortAgentOverlayRecords([
			record("worker-two"),
			record("self", { status: "running" }),
			record("worker-one", { pendingMessages: 2 }),
		], "self");

		expect(ordered.map((entry) => entry.id)).toEqual([
			"self",
			"worker-one",
			"worker-two",
		]);
	});
});
