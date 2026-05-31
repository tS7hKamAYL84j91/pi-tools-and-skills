/**
 * Tests for team manifest metadata loaded through the registry.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { modelSlotsForTeam } from "../../extensions/pi-panopticon/teams/team-handlers.js";
import { validateTeamManifest } from "../../extensions/pi-panopticon/teams/team-manifest.js";
import { loadTeamRegistry } from "../../extensions/pi-panopticon/teams/team-registry.js";
import type { TeamSpec } from "../../extensions/pi-panopticon/teams/team-types.js";
import { withTempConfig, writeSubagent } from "./team-test-helpers.js";

function requireTeam(registry: ReturnType<typeof loadTeamRegistry>, id: string): TeamSpec {
	const team = registry.teams.get(id);
	if (!team) throw new Error(`Missing team ${id}`);
	return team;
}

describe("team manifest registry validation", () => {
	it("compiles and validates manifest-level prompt contracts and model slots", async () => {
		withTempConfig((configPath, root) => {
			writeSubagent(root, "graph_agent");
			writeFileSync(
				join(root, "teams", "manifest-graph.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "manifest-graph"',
					'name: "Manifest Graph"',
					'protocol: "graph"',
					"promptContracts:",
					'  - id: "node.template"',
					'    kind: "template"',
					'    defaultPromptId: "graph/node/template"',
					'    roles: ["node", "member"]',
					"modelSlots:",
					'  - id: "members"',
					'    kind: "member"',
					'    count: "dynamic"',
					'    label: "Graph member"',
					"agents:",
					'  - role: "draft"',
					'    subagent: "graph_agent"',
					'    model: "test/draft"',
					'  - role: "review"',
					'    subagent: "graph_agent"',
					'    model: "test/review"',
					"edges:",
					'  - from: "draft"',
					'    to: "review"',
					'outputs: ["review"]',
					"---",
					"Manifest graph body.",
				].join("\n"),
				"utf8",
			);

			const team = requireTeam(loadTeamRegistry(configPath, { roots: [] }), "manifest-graph");

			expect(team.promptContracts).toEqual([{ id: "node.template", kind: "template", defaultPromptId: "graph/node/template", roles: ["node", "member"] }]);
			expect(validateTeamManifest(team)).toEqual({ ok: true });
			expect(modelSlotsForTeam(team, team.models)).toEqual([
				{ id: "members:0", label: "Graph member", current: undefined, kind: "member", index: 0 },
				{ id: "members:1", label: "Graph member", current: undefined, kind: "member", index: 1 },
			]);
		});
	});

	it("rejects invalid manifest metadata before execution", async () => {
		withTempConfig((configPath, root) => {
			writeSubagent(root, "graph_agent");
			writeFileSync(
				join(root, "teams", "valid-graph.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "valid-graph"',
					'name: "Valid Graph"',
					'protocol: "graph"',
					"agents:",
					'  - role: "solo"',
					'    subagent: "graph_agent"',
					'    model: "test/solo"',
					"outputs: [\"solo\"]",
					"---",
					"Valid graph body.",
				].join("\n"),
				"utf8",
			);
			const team = requireTeam(loadTeamRegistry(configPath, { roots: [] }), "valid-graph");

			expect(() => validateTeamManifest({ ...team, promptContracts: [{ id: "node.template", kind: "template" }, { id: "node.template", kind: "template" }] })).toThrow('promptContracts has duplicate id "node.template".');
			expect(() => validateTeamManifest({ ...team, modelSlots: [{ id: "bad-count", kind: "member", count: 0 }] })).toThrow("modelSlots.bad-count.count must be dynamic or a positive integer.");
		});
	});

	it("reports strict manifest validator failures as registry warnings", async () => {
		withTempConfig((configPath, root) => {
			writeSubagent(root, "graph_agent");
			writeFileSync(
				join(root, "teams", "bad-slots.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "bad-slots"',
					'name: "Bad Slots"',
					'protocol: "graph"',
					"modelSlots:",
					'  - id: "members"',
					'    kind: "member"',
					"agents:",
					'  - role: "solo"',
					'    subagent: "graph_agent"',
					'    model: "test/solo"',
					"outputs: [\"solo\"]",
					"---",
					"Bad slots body.",
				].join("\n"),
				"utf8",
			);
			writeFileSync(
				join(root, "teams", "duplicate-slots.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "duplicate-slots"',
					'name: "Duplicate Slots"',
					'protocol: "graph"',
					"modelSlots:",
					'  - id: "members"',
					'    kind: "member"',
					'  - id: "members"',
					'    kind: "member"',
					"agents:",
					'  - role: "solo"',
					'    subagent: "graph_agent"',
					'    model: "test/solo"',
					"outputs: [\"solo\"]",
					"---",
					"Duplicate slots body.",
				].join("\n"),
				"utf8",
			);
			writeFileSync(
				join(root, "teams", "broken-edge.md"),
				[
					"---",
					"schemaVersion: 2",
					'id: "broken-edge"',
					'name: "Broken Edge"',
					'protocol: "graph"',
					"agents:",
					'  - role: "solo"',
					'    subagent: "graph_agent"',
					'    model: "test/solo"',
					"edges:",
					'  - from: "solo"',
					'    to: "missing"',
					"outputs: [\"solo\"]",
					"---",
					"Broken edge body.",
				].join("\n"),
				"utf8",
			);
			writeFileSync(
				join(root, "teams", "future-schema.md"),
				[
					"---",
					"schemaVersion: 3",
					'id: "future-schema"',
					'name: "Future Schema"',
					'protocol: "consult"',
					"agents:",
					'  - role: "navigator"',
					'    subagent: "graph_agent"',
					"---",
					"Future schema body.",
				].join("\n"),
				"utf8",
			);

			const registry = loadTeamRegistry(configPath, { roots: [] });

			expect(registry.teams.has("bad-slots")).toBe(true);
			expect(registry.teams.has("future-schema")).toBe(false);
			expect(registry.warnings).toContain('duplicate-slots: modelSlots has duplicate id "members".');
			expect(registry.warnings).toContain("broken-edge: legacy workflow fields are ignored; direct team protocols no longer execute generic workflows");
			expect(registry.warnings).toContain("future-schema: schemaVersion 2 is required");
		});
	});
});
