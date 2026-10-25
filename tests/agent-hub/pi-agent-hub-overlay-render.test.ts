/**
 * Narrow-width render coverage for pi-agent hub overlays.
 */

import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { renderAgentMessageOverlay } from "../../extensions/pi-agent-hub/ui/agent-message-overlay.js";
import {
	agentListCompact,
	agentListTooShort,
	AGENT_LIST_MIN_ROWS,
	agentListMaxVisible,
	isAgentDetailBackInput,
	renderAgentDetailOverlay,
	renderAgentListOverlay,
	sortAgentOverlayRecords,
	type AgentListOverlayArgs,
} from "../../extensions/pi-agent-hub/ui/agent-overlay.js";
import type { AgentRecord } from "../../extensions/pi-agent-hub/types.js";
import type { SessionEvent } from "../../lib/session-log.js";

const fakeTheme = {
	fg: (_name: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as import("@earendil-works/pi-coding-agent").Theme;

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

describe("pi-agent hub overlay renderers", () => {
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
			expect(body).toContain("Agent Hub");
			expect(body).toContain("> R self (you)");
			expect(body).toContain("enter detail");
			expect(body).toContain("/ filter");
			expect(body).toContain("esc close");
			expect(body).toContain("unread first");
			expectWidthBounded(lines, width);
		});

		it(`renders a filtered agent list within ${width} columns`, () => {
			const lines = renderAgentListOverlay({
				records,
				selfId: "self",
				theme: fakeTheme,
				width,
				searchActive: true,
				query: "blocked",
			});

			const body = lines.join("\n");
			expect(body).toContain("type to filter");
			expect(body).toContain("esc clear");
			expect(body).toContain("worker-one");
			expect(body).not.toMatch(/^ {2}S worker-two/m);
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
			expect(body).toContain("backspace/← list");
			expect(body).toContain("esc close");
			expect(body).toContain("c direct message");
			expect(body).toContain("m send");
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

	describe("agentListMaxVisible", () => {
		it("keeps the legacy full-list cap when rows are unknown", () => {
			expect(agentListMaxVisible(undefined, 15)).toBe(12);
		});

		// Mirrors pi-tui overlay clipping for { maxHeight: "80%", margin: 2 }:
		// rows=24 → maxHeightLines 19, chrome 9 → listBudget 10.
		it("keeps small lists unchanged on roomy terminals", () => {
			expect(agentListMaxVisible(24, 3)).toBe(3);
			expect(agentListMaxVisible(50, 12)).toBe(12);
			expect(agentListMaxVisible(60, 15)).toBe(12);
		});

		it("caps visible rows so clipped lists scroll instead of dropping selection", () => {
			// Clipped list: one line reserved for SelectList's scroll-info row.
			expect(agentListMaxVisible(24, 16)).toBe(9);
			// rows=20 → maxHeightLines 16 → listBudget 7.
			expect(agentListMaxVisible(20, 16)).toBe(6);
		});

		it("degrades to a single row on tiny terminals", () => {
			// rows=8 → maxHeightLines 4 → listBudget 1 → reserve scroll row.
			expect(agentListMaxVisible(8, 6)).toBe(1);
		});
	});

	// Regression guard: the rendered overlay must fit pi-tui's maxHeight clip at
	// every width, otherwise the clip silently drops bottom rows and the selected
	// agent can scroll out of view.
	describe("overlay height fits the maxHeight clip", () => {
		const maxHeightLines = (rows: number) =>
			Math.max(1, Math.min(Math.floor(rows * 0.8), Math.max(1, rows - 4)));
		const height = (args: AgentListOverlayArgs & { searchActive?: boolean; query?: string }) =>
			renderAgentListOverlay(args).length;

		// Full sweep: every supported terminal height, a range of widths, and
		// list sizes above and below the visible cap.
		it("stays within the clip across rows, widths, and agent counts", () => {
			const counts = [1, 3, 8, 16, 20];
			for (let rows = 12; rows <= 40; rows += 1) {
				for (const width of [40, 52, 60, 80, 120, 160]) {
					for (const count of counts) {
						const many = Array.from({ length: count }, (_unused, index) => record(`worker-${index}`));
						const compact = agentListCompact(rows);
						expect(
							height({
								records: many,
								selfId: "self",
								theme: fakeTheme,
								width,
								compact,
								maxVisible: agentListMaxVisible(rows, count, compact),
							}),
							`rows=${rows} width=${width} count=${count}`,
						).toBeLessThanOrEqual(maxHeightLines(rows));
					}
				}
			}
		});

		it("keeps a filtered (search-active) list within the clip too", () => {
			const many = Array.from({ length: 16 }, (_unused, index) => record(`worker-${index}`));
			expect(
				height({
					records: many,
					selfId: "self",
					theme: fakeTheme,
					width: 80,
					searchActive: true,
					query: "worker",
					maxVisible: agentListMaxVisible(24, many.length),
				}),
			).toBeLessThanOrEqual(maxHeightLines(24));
		});

		// D4: terminals shorter than the full chrome drop the status block so a
		// list row still fits instead of the clip cutting the selected row.
		it("fits the clip on short terminals by dropping the status block", () => {
			const many = Array.from({ length: 16 }, (_unused, index) => record(`worker-${index}`));
			for (const rows of [12, 13]) {
				expect(agentListCompact(rows)).toBe(true);
				expect(
					height({
						records: many,
						selfId: "self",
						theme: fakeTheme,
						width: 80,
						compact: true,
						maxVisible: agentListMaxVisible(rows, many.length, true),
					}),
				).toBeLessThanOrEqual(maxHeightLines(rows));
			}
		});

		it("keeps the status block at 14 rows and above", () => {
			expect(agentListCompact(13)).toBe(true);
			expect(agentListCompact(14)).toBe(false);
			expect(agentListCompact(undefined)).toBe(false);
		});

		it("skips the overlay below the documented 12-row floor", () => {
			expect(agentListTooShort(11)).toBe(true);
			expect(agentListTooShort(12)).toBe(false);
			expect(agentListTooShort(undefined)).toBe(false);
			expect(AGENT_LIST_MIN_ROWS).toBe(12);
		});
	});

	it("detects detail back-navigation keys", () => {
		expect(isAgentDetailBackInput("\x7f")).toBe(true);
		expect(isAgentDetailBackInput("\x1b[D")).toBe(true);
		expect(isAgentDetailBackInput("\x1b")).toBe(false);
		expect(isAgentDetailBackInput("c")).toBe(false);
	});

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
