/**
 * Narrow-width render coverage for pi-teams overlays.
 */

import { Input, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import {
	renderTeamBrowserOverlay,
	renderTeamOverlay,
} from "../../extensions/pi-panopticon/teams/team-overlay.js";
import type { TeamSpec } from "../../extensions/pi-panopticon/teams/team-types.js";

const fakeTheme = {
	fg: (_name: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as import("@earendil-works/pi-coding-agent").Theme;

function team(id: string, overrides: Partial<TeamSpec> = {}): TeamSpec {
	return {
		schemaVersion: 2,
		id,
		name: `${id} team with a deliberately long display name`,
		description: `Description for ${id} that is long enough to require width bounding in narrow terminals.`,
		protocol: "consult",
		prompts: {},
		agents: [`${id}-navigator`],
		agentBindings: [{ role: "navigator", subagent: `${id}-navigator` }],
		models: {},
		limits: {},
		source: "builtin",
		path: `/tmp/${id}.md`,
		...overrides,
	};
}

function expectWidthBounded(lines: string[], width: number): void {
	for (const line of lines) {
		expect(visibleWidth(line)).toBeLessThanOrEqual(width);
	}
}

describe("pi-teams overlay renderers", () => {
	const teams = [
		team("consult"),
		team("llm-council", { protocol: "debate" }),
	];

	for (const width of [80, 60]) {
		it(`renders the team browser within ${width} columns`, () => {
			const lines = renderTeamBrowserOverlay({
				teams,
				selected: 0,
				theme: fakeTheme,
				width,
			});

			expect(lines.join("\n")).toContain(" Teams");
			expect(lines.join("\n")).toContain("> consult");
			expect(lines.join("\n")).toContain("/ filter");
			expect(lines.join("\n")).toContain("esc");
			expectWidthBounded(lines, width);
		});

		it(`renders the team browser filter state within ${width} columns`, () => {
			const searchInput = new Input();
			searchInput.setValue("debate");
			const lines = renderTeamBrowserOverlay({
				teams,
				selected: 0,
				theme: fakeTheme,
				width,
				searchActive: true,
				searchInput,
				query: "debate",
			});

			const body = lines.join("\n");
			expect(body).toContain("llm-council");
			expect(body).toContain("type to filter · ↑/↓ navigate · enter detail · esc close");
			expectWidthBounded(lines, width);
		});

		it(`renders team detail content within ${width} columns`, () => {
			const detailLines = [
				"Consult Team (consult)",
				"Source: builtin",
				"Protocol: consult",
				"Description: A concise team detail overlay for narrow-width regression coverage.",
			];
			const lines = renderTeamOverlay("Team Detail", detailLines, fakeTheme, width);

			expect(lines.join("\n")).toContain(" Team Detail");
			expect(lines.join("\n")).toContain(" esc close");
			expectWidthBounded(lines, width);
		});

		it(`truncates long team detail content within ${width} columns`, () => {
			const detailLines = Array.from({ length: 20 }, (_unused, index) =>
				`Detail line ${index + 1} with narrow-width-safe content`,
			);
			const lines = renderTeamOverlay("Team Detail", detailLines, fakeTheme, width);

			const body = lines.join("\n");
			expect(body).toContain("...+6 more lines");
			expect(body).not.toContain("Detail line 20");
			expectWidthBounded(lines, width);
		});
	}
});
