/**
 * Narrow-width render coverage for pi-teams overlays.
 */

import { CURSOR_MARKER, Input, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import {
	createTeamBrowserComponent,
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
			expect(lines.join("\n")).toContain("r run");
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
			expect(body).toContain("type to filter · ↑/↓ navigate · enter detail · esc clear");
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

	it("keeps IME focus on search and clears it when opening detail", () => {
		const actions: Array<{ type: string; id?: string } | undefined> = [];
		const component = createTeamBrowserComponent({
			// The component only uses cwd and ui.notify from this focused context fixture.
			ctx: {
				cwd: "/tmp",
				ui: { notify: () => undefined },
			} as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext,
			tui: { requestRender: () => undefined },
			theme: fakeTheme,
			done: (action) => actions.push(action),
			teams: [team("project-team", { source: "project" })],
		});

		component.focused = true;
		component.handleInput?.("/");
		expect(component.render(60).join("\n")).toContain(CURSOR_MARKER);
		component.handleInput?.("\r");

		const detail = component.render(60).join("\n");
		expect(detail).toContain("Team Detail");
		expect(detail).toContain("backspace/← list");
		expect(detail).not.toContain(CURSOR_MARKER);
		expect(actions).toEqual([]);
	});

	it("exposes one-shot run actions from list and detail modes", () => {
		const actions: Array<{ type: string; id?: string } | undefined> = [];
		const createComponent = () => createTeamBrowserComponent({
			ctx: {
				cwd: "/tmp",
				ui: { notify: () => undefined },
			} as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext,
			tui: { requestRender: () => undefined },
			theme: fakeTheme,
			done: (action) => actions.push(action),
			teams: [team("navigator")],
		});

		createComponent().handleInput?.("r");
		const detailComponent = createComponent();
		detailComponent.handleInput?.("\r");
		expect(detailComponent.render(60).join("\n")).toContain("r run");
		detailComponent.handleInput?.("r");

		expect(actions).toEqual([
			{ type: "run", id: "navigator" },
			{ type: "run", id: "navigator" },
		]);
	});

	it("cancels delete confirmation before running focused detail actions", () => {
		const actions: Array<{ type: string; id?: string } | undefined> = [];
		const component = createTeamBrowserComponent({
			// The component only uses cwd and ui.notify from this focused context fixture.
			ctx: {
				cwd: "/tmp",
				ui: { notify: () => undefined },
			} as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext,
			tui: { requestRender: () => undefined },
			theme: fakeTheme,
			done: (action) => actions.push(action),
			teams: [team("project-team", { source: "project" })],
		});

		component.handleInput?.("\r");
		component.handleInput?.("d");
		expect(component.render(60).join("\n")).toContain("Delete team");
		component.handleInput?.("\x1b");
		expect(component.render(60).join("\n")).toContain("Team Detail");
		expect(actions).toEqual([]);

		component.handleInput?.("m");
		expect(actions).toEqual([{ type: "models", id: "project-team" }]);
	});
});
