/**
 * Cockpit decisions panel tests: SPR line parsing, filtering, and bounds.
 */
import { describe, expect, it } from "vitest";

import {
	decisionLabel,
	filterDecisions,
	parseDecisionLog,
} from "../../pi-cockpit/decisions.ts";

const SAMPLE = `# Decisions

One SPR line per decision.

- 001 Automations tool error handling — \`execute()\` handlers wrap work in try/catch.
- 002 TruncatedText limitHit — \`truncateText\` sets optional \`limitHit\`.
Not a decision line.
- 064 Extension renames for clarity — \`pi-panopticon\` → \`pi-agent-hub\`.
`;

describe("cockpit decisions", () => {
	it("parses SPR lines into number, title, and facts", () => {
		const entries = parseDecisionLog(SAMPLE);
		expect(entries).toHaveLength(3);
		expect(entries[0]).toEqual({
			number: "001",
			title: "Automations tool error handling",
			facts: "`execute()` handlers wrap work in try/catch.",
		});
		expect(entries.map(decisionLabel)).toContain("064 Extension renames for clarity");
	});

	it("ignores prose and headings", () => {
		const entries = parseDecisionLog(SAMPLE);
		expect(entries.some((entry) => entry.title.includes("Not a decision"))).toBe(false);
	});

	it("filters case-insensitively over number, title, and facts", () => {
		const entries = parseDecisionLog(SAMPLE);
		expect(filterDecisions(entries, "truncated")).toHaveLength(1);
		expect(filterDecisions(entries, "064")).toHaveLength(1);
		expect(filterDecisions(entries, "PANOPTICON")).toHaveLength(1);
		expect(filterDecisions(entries, "")).toHaveLength(3);
		expect(filterDecisions(entries, "no-such-decision")).toHaveLength(0);
	});

	it("tolerates a hyphen separator and a missing facts segment", () => {
		const entries = parseDecisionLog("- 007 Plain title - with hyphen facts\n- 008 Bare title");
		expect(entries[0]).toEqual({ number: "007", title: "Plain title", facts: "with hyphen facts" });
		expect(entries[1]).toEqual({ number: "008", title: "Bare title", facts: "" });
	});
});