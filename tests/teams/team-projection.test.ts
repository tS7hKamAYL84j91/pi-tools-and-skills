/**
 * Tests for built-in team seed projection (ADR 026).
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectBuiltinTeams, pruneBuiltinTeams } from "../../extensions/pi-teams/team-projection.js";

const BUILTIN_IDS = ["deep-research", "fusion-analysis", "hierarchical-swarm-default", "llm-council", "navigator"];

function fakeCtx(cwd: string): ExtensionContext {
	return { cwd } as unknown as ExtensionContext;
}

let dest: string;

beforeEach(() => {
	dest = mkdtempSync(join(tmpdir(), "team-proj-dest-"));
});

afterEach(() => {
	rmSync(dest, { recursive: true, force: true });
});

describe("projectBuiltinTeams", () => {
	it("projects all built-in seeds verbatim into the user dir with a seed marker", async () => {
		const result = await projectBuiltinTeams(fakeCtx(dest), { userTeamsDir: dest });

		expect([...result.projected].sort()).toEqual(BUILTIN_IDS);
		expect(result.skipped).toEqual([]);
		expect(result.overwritten).toEqual([]);

		const council = readFileSync(join(dest, "llm-council.md"), "utf8");
		// Front matter preserved verbatim, including pinned models (no stripping).
		expect(council.startsWith("---\n")).toBe(true);
		expect(council).toContain('model: "ollama/qwen3.5:cloud"');
		// Seed marker inserted as an invisible HTML comment in the body.
		expect(council).toContain('<!-- pi-teams seed projection of "llm-council"');
	});

	it("does not overwrite an existing user file (preexisting edit preserved)", async () => {
		writeFileSync(
			join(dest, "navigator.md"),
			'---\nschemaVersion: 2\nid: "navigator"\nprotocol: "consult"\nagents:\n  - role: "navigator"\n    subagent: "consult_navigator"\n    model: "my/custom-edit"\n---\nmy custom body\n',
			"utf8",
		);

		const result = await projectBuiltinTeams(fakeCtx(dest), { userTeamsDir: dest });

		expect(result.skipped).toContain("navigator");
		expect([...result.projected].sort()).toEqual(["deep-research", "fusion-analysis", "hierarchical-swarm-default", "llm-council"]);
		const nav = readFileSync(join(dest, "navigator.md"), "utf8");
		expect(nav).toContain("my/custom-edit");
		expect(nav).not.toContain("seed projection");
	});

	it("is idempotent (a second call skips everything and writes nothing)", async () => {
		await projectBuiltinTeams(fakeCtx(dest), { userTeamsDir: dest });
		const before = readdirSync(dest).sort();

		const second = await projectBuiltinTeams(fakeCtx(dest), { userTeamsDir: dest });

		expect(second.projected).toEqual([]);
		expect([...second.skipped].sort()).toEqual(BUILTIN_IDS);
		expect(readdirSync(dest).sort()).toEqual(before);
	});

	it("force overwrites existing user files for built-in ids", async () => {
		writeFileSync(join(dest, "navigator.md"), "CUSTOM", "utf8");

		const result = await projectBuiltinTeams(fakeCtx(dest), { userTeamsDir: dest, force: true });

		expect(result.overwritten).toContain("navigator");
		expect([...result.projected].sort()).toEqual(["deep-research", "fusion-analysis", "hierarchical-swarm-default", "llm-council"]);
		const nav = readFileSync(join(dest, "navigator.md"), "utf8");
		expect(nav).not.toContain("CUSTOM");
		expect(nav).toContain("seed projection");
	});

	it("returns an empty manifest when there are no built-in seeds", async () => {
		const result = await projectBuiltinTeams(fakeCtx(dest), {
			userTeamsDir: dest,
			configPath: join(dest, "missing-config.json"),
		});

		expect(result.projected).toEqual([]);
		expect(result.skipped).toEqual([]);
		expect(existsSync(join(dest, "teams"))).toBe(false);
	});
});

describe("pruneBuiltinTeams", () => {
	it("removes user-scope files for ids no longer in built-in seeds", async () => {
		await projectBuiltinTeams(fakeCtx(dest), { userTeamsDir: dest });
		writeFileSync(join(dest, "router-fusion.md"), '---\nschemaVersion: 2\nid: "router-fusion"\n---\n\n<!-- pi-panopticon seed projection of "router-fusion". This file is the source of truth for this team; edit it freely. Re-project missing seeds with /teams seed. -->\n\nstale seed\n', "utf8");

		const result = await pruneBuiltinTeams(fakeCtx(dest), { userTeamsDir: dest });

		expect([...result.removed].sort()).toEqual(["router-fusion"]);
		expect(existsSync(join(dest, "router-fusion.md"))).toBe(false);
		expect(existsSync(join(dest, "navigator.md"))).toBe(true);
	});

	it("preserves custom user files without the seed marker", async () => {
		await projectBuiltinTeams(fakeCtx(dest), { userTeamsDir: dest });
		writeFileSync(join(dest, "custom-team.md"), '---\nschemaVersion: 2\nid: "custom-team"\n---\n\ncustom body\n', "utf8");

		const result = await pruneBuiltinTeams(fakeCtx(dest), { userTeamsDir: dest });

		expect(result.removed).toEqual([]);
		expect(existsSync(join(dest, "custom-team.md"))).toBe(true);
	});

	it("is idempotent", async () => {
		await projectBuiltinTeams(fakeCtx(dest), { userTeamsDir: dest });

		const first = await pruneBuiltinTeams(fakeCtx(dest), { userTeamsDir: dest });
		const second = await pruneBuiltinTeams(fakeCtx(dest), { userTeamsDir: dest });

		expect(first.removed).toEqual([]);
		expect(second.removed).toEqual([]);
	});
});