import { describe, expect, it } from "vitest";
import { validateTeamManifest } from "../../extensions/pi-teams/team-manifest.js";
import type { TeamSpec } from "../../extensions/pi-teams/team-types.js";

function team(overrides: Partial<TeamSpec> = {}): TeamSpec {
	return {
		schemaVersion: 2,
		id: "minimal",
		name: "Minimal",
		protocol: "consult",
		prompts: {},
		agents: ["navigator"],
		agentBindings: [{ role: "navigator", subagent: "navigator", model: "test/navigator" }],
		models: { navigator: "test/navigator" },
		limits: {},
		source: "project",
		path: "minimal.md",
		...overrides,
	};
}

describe("validateTeamManifest", () => {
	it("accepts a valid minimal config", () => {
		expect(validateTeamManifest(team())).toEqual({ ok: true });
	});

	it("rejects missing or invalid required fields", () => {
		expect(() => validateTeamManifest(team({ id: "" }))).toThrow(/id/);
		expect(() => validateTeamManifest(team({ name: "" }))).toThrow(/name/);
		expect(() => validateTeamManifest({ ...team(), schemaVersion: 1 as 2 })).toThrow(/schemaVersion/);
	});

	it("rejects invalid model ids at config time", () => {
		expect(() => validateTeamManifest(team({ models: { navigator: "missing-provider" } }))).toThrow(/provider\/model/);
		expect(() => validateTeamManifest(team({ models: { members: ["test/member"], synthesis: "" } }))).toThrow(/models.synthesis/);
	});

	it("rejects unsupported prompt/model slot values", () => {
		expect(() => validateTeamManifest(team({ promptContracts: [{ id: "x", kind: "bad" as never }] }))).toThrow(/kind/);
		expect(() => validateTeamManifest(team({ modelSlots: [{ id: "x", kind: "bad" as never }] }))).toThrow(/kind/);
	});

	it("keeps approval gates default-disabled and requires explicit owner when enabled", () => {
		expect(validateTeamManifest(team())).toEqual({ ok: true });
		expect(validateTeamManifest(team({ approval: { enabled: false } }))).toEqual({ ok: true });
		expect(() => validateTeamManifest(team({ approval: { enabled: true } }))).toThrow(/approval.owner/);
		expect(validateTeamManifest(team({ approval: { enabled: true, owner: "principal", source: "human" } }))).toEqual({ ok: true });
		expect(() => validateTeamManifest(team({ approval: { enabled: true, owner: "principal", source: "bot" as never } }))).toThrow(/approval.source/);
	});
});
