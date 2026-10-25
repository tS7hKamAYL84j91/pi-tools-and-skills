/**
 * Adversarial acceptance: agent-list overlay height budget.
 *
 * Claim (extensions/pi-agent-hub/ui/agent-list.ts + README):
 * - full chrome (9 lines, incl. the reserved search row) fits rows >= 14
 * - rows 12-13 drop the status block (compact, 6 lines)
 * - rows < 12 do not open the overlay at all: notify + skip
 * - chrome is width-stable, and "selection never scrolls out of view"
 *
 * These tests measure the rendered overlay and the real open path across a grid
 * of terminal sizes instead of trusting the constants.
 */
import { describe, expect, it } from "vitest";
import {
	AGENT_LIST_MIN_ROWS,
	agentListCompact,
	agentListMaxVisible,
	agentListTooShort,
	renderAgentListOverlay,
} from "../../extensions/pi-agent-hub/ui/agent-overlay.js";
import { openAgentListOverlay } from "../../extensions/pi-agent-hub/ui/agent-list.js";
import type { AgentRecord } from "../../extensions/pi-agent-hub/types.js";

const theme = {
	fg: (_name: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as import("@earendil-works/pi-coding-agent").Theme;

function record(index: number): AgentRecord {
	return {
		id: `agent-${index}`,
		name: `agent-${index}`,
		pid: 100 + index,
		cwd: "/tmp/work",
		model: "m",
		status: "running",
		heartbeat: Date.now(),
		startedAt: Date.now() - 1000,
	} as AgentRecord;
}

function records(count: number): AgentRecord[] {
	return Array.from({ length: count }, (_, index) => record(index));
}

/** pi-tui overlay math for { maxHeight: "80%", margin: 2 }. */
function overlayMaxHeightLines(rows: number): number {
	return Math.max(1, Math.min(Math.floor(rows * 0.8), Math.max(1, rows - 4)));
}

function render(agentCount: number, width: number, maxVisible?: number, compact = false): string[] {
	return renderAgentListOverlay({
		records: records(agentCount),
		selfId: "agent-0",
		theme,
		width,
		compact,
		...(maxVisible === undefined ? {} : { maxVisible }),
	});
}

describe("agent list overlay height acceptance", () => {
	it("keeps chrome single-line from 40 to 160 columns", () => {
		const full = [40, 52, 70, 80, 120, 160].map((width) => render(3, width).length);
		const compact = [40, 52, 70, 80, 120, 160].map((width) => render(3, width, undefined, true).length);
		expect(new Set(full).size).toBe(1);
		expect(new Set(compact).size).toBe(1);
		expect(full[0]).toBe(compact[0]! + 3);
	});

	it("fits the full-chrome clip from 14 rows up", () => {
		const failures: string[] = [];
		for (const rows of [14, 20, 24, 30, 40, 60]) {
			for (const width of [40, 80, 120]) {
				for (const agentCount of [1, 3, 8, 12, 16, 30]) {
					const rendered = render(agentCount, width, agentListMaxVisible(rows, agentCount), agentListCompact(rows));
					const limit = overlayMaxHeightLines(rows);
					if (rendered.length > limit) {
						failures.push(`rows=${rows} width=${width} agents=${agentCount}: ${rendered.length} > ${limit}`);
					}
					// pi-tui clips from the bottom; a surviving border proves nothing was dropped.
					if (!rendered.at(-1)?.includes("───")) {
						failures.push(`rows=${rows} width=${width} agents=${agentCount}: bottom border missing`);
					}
				}
			}
		}
		expect(failures).toEqual([]);
	});

	it("fits the compact-chrome clip at 12-13 rows", () => {
		for (const rows of [12, 13]) {
			expect(agentListCompact(rows)).toBe(true);
			expect(agentListTooShort(rows)).toBe(false);
			for (const width of [40, 80, 120]) {
				const rendered = render(30, width, agentListMaxVisible(rows, 30, true), true);
				expect(rendered.length).toBeLessThanOrEqual(overlayMaxHeightLines(rows));
				expect(rendered.at(-1)).toContain("───");
			}
		}
	});

	it("declares the skip floor and does not render an overlay below it", async () => {
		expect(AGENT_LIST_MIN_ROWS).toBe(12);
		expect(agentListTooShort(11)).toBe(true);
		expect(agentListTooShort(12)).toBe(false);
		expect(agentListTooShort(undefined)).toBe(false);

		const notices: string[] = [];
		let rendered: string[] | undefined;
		let doneWith: string | null | undefined;
		const self = record(0);
		// Mirror pi's ctx.ui.custom contract: the promise resolves with the value the
		// component passes to innerDone. The guard resolves via queueMicrotask, so the
		// resolve must come from that callback rather than from the factory's return.
		const ctx = {
			ui: {
				notify: (message: string) => notices.push(message),
				custom: (factory: (tui: unknown, theme: unknown, kb: unknown, done: (v: string | null) => void) => unknown) =>
					new Promise<string | null>((resolve) => {
						const component = factory(
							{ terminal: { rows: 11 }, requestRender: () => {} },
							theme,
							{},
							resolve,
						) as { render: (width: number) => string[] } | undefined;
						rendered = component?.render(80);
					}),
			},
		};
		const deps = {
			selfId: self.id,
			registry: { getRecord: () => self, readAllPeers: () => records(6) },
			listMode: { get: () => "all" as const, set: () => {} },
			sendAgentMessage: async () => ({ accepted: true }),
			stopAgent: async () => ({ accepted: true }),
		};

		await openAgentListOverlay(
			ctx as unknown as Parameters<typeof openAgentListOverlay>[0],
			deps as unknown as Parameters<typeof openAgentListOverlay>[1],
			(value: string | null) => {
				doneWith = value;
			},
		);
		expect(notices.join(" ")).toContain(`needs ${AGENT_LIST_MIN_ROWS}+ rows`);
		expect(rendered ?? []).toEqual([]);
		expect(doneWith).toBeNull();
	});

	it("keeps the selected row on screen with a capped list", () => {
		const maxVisible = agentListMaxVisible(24, 30);
		const lines = render(30, 80, maxVisible);
		const selectable = lines.filter((line) => /^[> ] [R?⏸✗] agent-\d+/.test(line));
		expect(selectable.length).toBeGreaterThan(0);
		expect(selectable.length).toBeLessThanOrEqual(maxVisible);
		expect(selectable[0]).toContain("(you)");
	});
});
